
-- ============================================
-- EOI Polish: analytics, returning detection, thank-you redirect
-- ============================================

-- 1. Thank-you redirect URL on seasons
ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS eoi_thank_you_redirect_url text;

-- 2. Form view analytics
CREATE TABLE IF NOT EXISTS public.eoi_form_views (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'website',
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eoi_form_views_season_idx
  ON public.eoi_form_views(season_id, viewed_at DESC);

ALTER TABLE public.eoi_form_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can record EOI form view" ON public.eoi_form_views;
CREATE POLICY "Anyone can record EOI form view"
ON public.eoi_form_views FOR INSERT TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Club managers read EOI form views" ON public.eoi_form_views;
CREATE POLICY "Club managers read EOI form views"
ON public.eoi_form_views FOR SELECT TO authenticated
USING (public.can_manage_club_eois(club_id));

-- 3. Update get_public_eoi_config to include redirect URL
DROP FUNCTION IF EXISTS public.get_public_eoi_config(text, text);
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
  thank_you_redirect_url text,
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
    s.eoi_thank_you_redirect_url,
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

-- 4. Returning player auto-detection: match incoming EOI emails against existing
--    club members (parents) and flag returning_player accordingly.
CREATE OR REPLACE FUNCTION public.detect_returning_eoi_player()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing_user_id uuid;
  _matched_child_id uuid;
BEGIN
  -- Find a profile with this email that already belongs to the club
  SELECT p.id INTO _existing_user_id
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE lower(p.email) = lower(NEW.parent_email)
    AND ur.club_id = NEW.club_id
  LIMIT 1;

  IF _existing_user_id IS NOT NULL THEN
    NEW.returning_player := true;
    -- Try linking to an existing child by name match (case-insensitive)
    SELECT ch.id INTO _matched_child_id
    FROM public.children ch
    WHERE ch.parent_id = _existing_user_id
      AND lower(trim(ch.name)) = lower(trim(NEW.player_name))
    LIMIT 1;
    IF _matched_child_id IS NOT NULL THEN
      NEW.child_id := _matched_child_id;
      NEW.parent_user_id := _existing_user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS detect_returning_eoi_player_trg ON public.eoi_submissions;
CREATE TRIGGER detect_returning_eoi_player_trg
  BEFORE INSERT ON public.eoi_submissions
  FOR EACH ROW EXECUTE FUNCTION public.detect_returning_eoi_player();

-- 5. Stats RPC: extend to expose view count + conversion rate
DROP FUNCTION IF EXISTS public.get_eoi_stats(uuid, uuid);
CREATE OR REPLACE FUNCTION public.get_eoi_stats(_club_id uuid, _season_id uuid DEFAULT NULL)
RETURNS TABLE(
  total bigint,
  submitted bigint,
  allocated bigint,
  confirmed bigint,
  registered bigint,
  withdrawn bigint,
  new_players bigint,
  returning_players bigint,
  views bigint,
  conversion_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH subs AS (
    SELECT * FROM public.eoi_submissions
    WHERE club_id = _club_id
      AND (_season_id IS NULL OR season_id = _season_id)
  ),
  views_count AS (
    SELECT count(*)::bigint AS v
    FROM public.eoi_form_views
    WHERE club_id = _club_id
      AND (_season_id IS NULL OR season_id = _season_id)
  )
  SELECT
    (SELECT count(*) FROM subs)::bigint AS total,
    (SELECT count(*) FROM subs WHERE status = 'submitted')::bigint AS submitted,
    (SELECT count(*) FROM subs WHERE status = 'allocated')::bigint AS allocated,
    (SELECT count(*) FROM subs WHERE status = 'confirmed')::bigint AS confirmed,
    (SELECT count(*) FROM subs WHERE status = 'registered')::bigint AS registered,
    (SELECT count(*) FROM subs WHERE status = 'withdrawn')::bigint AS withdrawn,
    (SELECT count(*) FROM subs WHERE returning_player = false)::bigint AS new_players,
    (SELECT count(*) FROM subs WHERE returning_player = true)::bigint AS returning_players,
    (SELECT v FROM views_count) AS views,
    CASE
      WHEN (SELECT v FROM views_count) > 0
        THEN round(((SELECT count(*) FROM subs)::numeric / (SELECT v FROM views_count)::numeric) * 100, 1)
      ELSE 0
    END AS conversion_rate;
$$;

GRANT EXECUTE ON FUNCTION public.get_eoi_stats(uuid, uuid) TO authenticated;
