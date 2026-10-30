
-- ============================================
-- EOI System Phase 1: Foundation + Admin
-- ============================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.eoi_status AS ENUM (
    'invited',
    'submitted',
    'preferences_completed',
    'allocated',
    'confirmed',
    'registered',
    'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.eoi_source AS ENUM ('website', 'app', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend seasons with EOI config
ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS eoi_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eoi_slug text,
  ADD COLUMN IF NOT EXISTS eoi_opens_at timestamptz,
  ADD COLUMN IF NOT EXISTS eoi_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS eoi_welcome_message text,
  ADD COLUMN IF NOT EXISTS eoi_thank_you_message text,
  ADD COLUMN IF NOT EXISTS eoi_require_dob boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS eoi_require_gender boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eoi_ask_preferences boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS eoi_ask_availability boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS eoi_ask_skill_level boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS eoi_ask_position boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS seasons_club_eoi_slug_uq
  ON public.seasons(club_id, eoi_slug) WHERE eoi_slug IS NOT NULL;

-- Main EOI submissions table
CREATE TABLE IF NOT EXISTS public.eoi_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,

  parent_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  child_id uuid REFERENCES public.children(id) ON DELETE SET NULL,
  assigned_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,

  parent_name text NOT NULL,
  parent_email text NOT NULL,
  parent_mobile text,

  player_name text NOT NULL,
  player_dob date,
  player_gender text,
  age_group text,

  preferred_teammates text,
  preferred_position text,
  skill_level smallint CHECK (skill_level IS NULL OR (skill_level BETWEEN 1 AND 5)),
  notes text,
  returning_player boolean NOT NULL DEFAULT false,

  training_days text[] NOT NULL DEFAULT '{}',
  game_days text[] NOT NULL DEFAULT '{}',

  status public.eoi_status NOT NULL DEFAULT 'submitted',
  source public.eoi_source NOT NULL DEFAULT 'website',

  claim_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  claimed_at timestamptz,

  submitted_at timestamptz NOT NULL DEFAULT now(),
  allocated_at timestamptz,
  confirmed_at timestamptz,
  registered_at timestamptz,
  withdrawn_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eoi_submissions_club_season_idx
  ON public.eoi_submissions(club_id, season_id);
CREATE INDEX IF NOT EXISTS eoi_submissions_season_status_idx
  ON public.eoi_submissions(season_id, status);
CREATE INDEX IF NOT EXISTS eoi_submissions_parent_user_idx
  ON public.eoi_submissions(parent_user_id);
CREATE INDEX IF NOT EXISTS eoi_submissions_parent_email_idx
  ON public.eoi_submissions(lower(parent_email));
CREATE UNIQUE INDEX IF NOT EXISTS eoi_submissions_claim_token_uq
  ON public.eoi_submissions(claim_token);

DROP TRIGGER IF EXISTS trg_eoi_submissions_updated_at ON public.eoi_submissions;
CREATE TRIGGER trg_eoi_submissions_updated_at
  BEFORE UPDATE ON public.eoi_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.eoi_submissions ENABLE ROW LEVEL SECURITY;

-- Helper: is the EOI window currently open for the season?
CREATE OR REPLACE FUNCTION public.is_season_eoi_open(_season_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT s.eoi_enabled
        AND (s.eoi_opens_at IS NULL OR s.eoi_opens_at <= now())
        AND (s.eoi_closes_at IS NULL OR s.eoi_closes_at >= now())
      FROM public.seasons s
      WHERE s.id = _season_id
    ),
    false
  );
$$;

-- Helper: does current user manage EOIs for this club?
CREATE OR REPLACE FUNCTION public.can_manage_club_eois(_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'app_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.club_id = _club_id
        AND ur.role IN ('club_admin'::public.app_role, 'committee_member'::public.app_role)
    );
$$;

-- Public EOI config lookup for form rendering
CREATE OR REPLACE FUNCTION public.get_public_eoi_config(_club_slug text, _season_slug text)
RETURNS TABLE(
  season_id uuid,
  season_name text,
  club_id uuid,
  club_name text,
  club_logo_url text,
  is_open boolean,
  opens_at timestamptz,
  closes_at timestamptz,
  welcome_message text,
  thank_you_message text,
  require_dob boolean,
  require_gender boolean,
  ask_preferences boolean,
  ask_availability boolean,
  ask_skill_level boolean,
  ask_position boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    c.id,
    c.name,
    c.logo_url,
    public.is_season_eoi_open(s.id),
    s.eoi_opens_at,
    s.eoi_closes_at,
    s.eoi_welcome_message,
    s.eoi_thank_you_message,
    s.eoi_require_dob,
    s.eoi_require_gender,
    s.eoi_ask_preferences,
    s.eoi_ask_availability,
    s.eoi_ask_skill_level,
    s.eoi_ask_position
  FROM public.seasons s
  JOIN public.clubs c ON c.id = s.club_id
  WHERE s.eoi_enabled = true
    AND s.eoi_slug = _season_slug
    AND (
      lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g')) = lower(_club_slug)
      OR c.id::text = _club_slug
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_eoi_config(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_season_eoi_open(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_club_eois(uuid) TO authenticated;

-- RLS policies
CREATE POLICY "Public can submit EOI when season is open"
ON public.eoi_submissions FOR INSERT TO anon, authenticated
WITH CHECK (
  public.is_season_eoi_open(season_id)
  AND source IN ('website', 'app')
);

CREATE POLICY "Club managers can insert EOIs"
ON public.eoi_submissions FOR INSERT TO authenticated
WITH CHECK (public.can_manage_club_eois(club_id));

CREATE POLICY "Parent user can view own submission"
ON public.eoi_submissions FOR SELECT TO authenticated
USING (
  parent_user_id = auth.uid()
  OR lower(parent_email) = lower(COALESCE((auth.jwt() ->> 'email')::text, ''))
);

CREATE POLICY "Club managers can view club EOIs"
ON public.eoi_submissions FOR SELECT TO authenticated
USING (public.can_manage_club_eois(club_id));

CREATE POLICY "Parent can update own submission before close"
ON public.eoi_submissions FOR UPDATE TO authenticated
USING (
  (parent_user_id = auth.uid()
    OR lower(parent_email) = lower(COALESCE((auth.jwt() ->> 'email')::text, '')))
  AND public.is_season_eoi_open(season_id)
)
WITH CHECK (
  parent_user_id = auth.uid()
    OR lower(parent_email) = lower(COALESCE((auth.jwt() ->> 'email')::text, ''))
);

CREATE POLICY "Club managers can update club EOIs"
ON public.eoi_submissions FOR UPDATE TO authenticated
USING (public.can_manage_club_eois(club_id))
WITH CHECK (public.can_manage_club_eois(club_id));

CREATE POLICY "Club managers can delete club EOIs"
ON public.eoi_submissions FOR DELETE TO authenticated
USING (public.can_manage_club_eois(club_id));

-- RPC: fetch submission by claim token (no login needed)
CREATE OR REPLACE FUNCTION public.get_eoi_by_claim_token(_token text)
RETURNS public.eoi_submissions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.eoi_submissions WHERE claim_token = _token LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_eoi_by_claim_token(text) TO anon, authenticated;

-- RPC: claim an EOI to the current user
CREATE OR REPLACE FUNCTION public.claim_eoi_submission(_token text)
RETURNS public.eoi_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.eoi_submissions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be logged in to claim';
  END IF;

  UPDATE public.eoi_submissions
  SET parent_user_id = auth.uid(),
      claimed_at = COALESCE(claimed_at, now())
  WHERE claim_token = _token
    AND (parent_user_id IS NULL OR parent_user_id = auth.uid())
  RETURNING * INTO rec;

  RETURN rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_eoi_submission(text) TO authenticated;

-- Auto-claim EOIs by email on user creation/email change
CREATE OR REPLACE FUNCTION public.auto_claim_eois_by_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    UPDATE public.eoi_submissions
    SET parent_user_id = NEW.id,
        claimed_at = COALESCE(claimed_at, now())
    WHERE parent_user_id IS NULL
      AND lower(parent_email) = lower(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_claim_eois ON auth.users;
CREATE TRIGGER trg_auto_claim_eois
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_claim_eois_by_email();

-- Stats RPC for admin dashboard
CREATE OR REPLACE FUNCTION public.get_eoi_stats(_club_id uuid, _season_id uuid DEFAULT NULL)
RETURNS TABLE(
  total bigint,
  submitted bigint,
  preferences_completed bigint,
  allocated bigint,
  confirmed bigint,
  registered bigint,
  withdrawn bigint,
  returning_players bigint,
  new_players bigint,
  source_website bigint,
  source_app bigint,
  source_admin bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE status = 'submitted')::bigint,
    COUNT(*) FILTER (WHERE status = 'preferences_completed')::bigint,
    COUNT(*) FILTER (WHERE status = 'allocated')::bigint,
    COUNT(*) FILTER (WHERE status = 'confirmed')::bigint,
    COUNT(*) FILTER (WHERE status = 'registered')::bigint,
    COUNT(*) FILTER (WHERE status = 'withdrawn')::bigint,
    COUNT(*) FILTER (WHERE returning_player)::bigint,
    COUNT(*) FILTER (WHERE NOT returning_player)::bigint,
    COUNT(*) FILTER (WHERE source = 'website')::bigint,
    COUNT(*) FILTER (WHERE source = 'app')::bigint,
    COUNT(*) FILTER (WHERE source = 'admin')::bigint
  FROM public.eoi_submissions
  WHERE club_id = _club_id
    AND (_season_id IS NULL OR season_id = _season_id)
    AND public.can_manage_club_eois(_club_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_eoi_stats(uuid, uuid) TO authenticated;
