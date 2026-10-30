
-- 1. Add join token to competitions
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS join_token uuid,
  ADD COLUMN IF NOT EXISTS join_token_enabled boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitions_join_token
  ON public.competitions(join_token) WHERE join_token IS NOT NULL;

-- Backfill existing competitions
UPDATE public.competitions SET join_token = gen_random_uuid() WHERE join_token IS NULL;

-- 2. Fix arg-order bug in previous shell-invite RPC
CREATE OR REPLACE FUNCTION public.invite_shell_team_to_competition(
  p_competition_id uuid,
  p_team_name text,
  p_club_name text,
  p_contact_name text,
  p_contact_email text,
  p_division_id uuid DEFAULT NULL
)
RETURNS TABLE(team_id uuid, club_id uuid, token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(p_contact_email));
  v_team_name text := trim(p_team_name);
  v_club_name text := nullif(trim(coalesce(p_club_name,'')), '');
  v_contact text := nullif(trim(coalesce(p_contact_name,'')), '');
  v_club_id uuid;
  v_team_id uuid;
  v_token uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT public.is_competition_admin(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'not_competition_admin';
  END IF;
  IF v_team_name = '' THEN RAISE EXCEPTION 'team_name_required'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;

  INSERT INTO public.clubs (name, kind, created_by, is_pro)
  VALUES (coalesce(v_club_name, v_team_name), 'shell', v_uid, false)
  RETURNING id INTO v_club_id;

  INSERT INTO public.teams (
    name, club_id, created_by, is_shell,
    shell_contact_name, shell_contact_email, shell_claim_token,
    shell_invited_by, shell_last_invite_sent_at
  ) VALUES (
    v_team_name, v_club_id, v_uid, true,
    v_contact, v_email, v_token,
    v_uid, now()
  ) RETURNING id INTO v_team_id;

  INSERT INTO public.competition_entries (
    competition_id, team_id, division_id, status, invited_by
  ) VALUES (
    p_competition_id, v_team_id, p_division_id, 'invited', v_uid
  );

  RETURN QUERY SELECT v_team_id, v_club_id, v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_shell_team_to_competition(uuid, text, text, text, text, uuid) TO authenticated;

-- 3. Regenerate join token (admin only)
CREATE OR REPLACE FUNCTION public.regenerate_competition_join_token(p_competition_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT public.is_competition_admin(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'not_competition_admin';
  END IF;
  UPDATE public.competitions
     SET join_token = v_token, join_token_enabled = true
   WHERE id = p_competition_id;
  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_competition_join_token(uuid) TO authenticated;

-- 4. Public lookup by token (anyone holding the token can see the comp's name + divisions)
CREATE OR REPLACE FUNCTION public.get_competition_by_join_token(p_token uuid)
RETURNS TABLE(
  id uuid,
  name text,
  organizer_club_id uuid,
  organizer_club_name text,
  sport text,
  season text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.name, c.organizer_club_id, cl.name, c.sport, c.season, c.status
  FROM public.competitions c
  LEFT JOIN public.clubs cl ON cl.id = c.organizer_club_id
  WHERE c.join_token = p_token AND c.join_token_enabled = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_by_join_token(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_divisions_by_join_token(p_token uuid)
RETURNS TABLE(id uuid, name text, age_group text, gender text, skill_level text, sort_order int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT d.id, d.name, d.age_group, d.gender, d.skill_level, d.sort_order
  FROM public.competition_divisions d
  JOIN public.competitions c ON c.id = d.competition_id
  WHERE c.join_token = p_token AND c.join_token_enabled = true
  ORDER BY d.sort_order, d.name;
$$;

GRANT EXECUTE ON FUNCTION public.list_divisions_by_join_token(uuid) TO anon, authenticated;

-- 5. Self-join with token using an existing team
CREATE OR REPLACE FUNCTION public.join_competition_with_token(
  p_token uuid,
  p_team_id uuid,
  p_division_id uuid DEFAULT NULL
)
RETURNS TABLE(competition_id uuid, entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_comp_id uuid;
  v_team_club uuid;
  v_is_team_admin boolean;
  v_entry_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT id INTO v_comp_id
  FROM public.competitions
  WHERE join_token = p_token AND join_token_enabled = true
  LIMIT 1;
  IF v_comp_id IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  SELECT club_id INTO v_team_club FROM public.teams WHERE id = p_team_id;
  IF v_team_club IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid
      AND role IN ('team_admin','club_admin','app_admin')
      AND (team_id = p_team_id OR (role IN ('club_admin','app_admin') AND (club_id = v_team_club OR club_id IS NULL)))
  ) INTO v_is_team_admin;

  IF NOT v_is_team_admin THEN RAISE EXCEPTION 'not_team_admin'; END IF;

  INSERT INTO public.competition_entries (competition_id, team_id, division_id, status, invited_by, responded_by, responded_at)
  VALUES (v_comp_id, p_team_id, p_division_id, 'accepted', v_uid, v_uid, now())
  ON CONFLICT (competition_id, team_id) DO UPDATE
    SET status = CASE WHEN public.competition_entries.status IN ('declined','withdrawn','removed','invited')
                      THEN 'accepted' ELSE public.competition_entries.status END,
        division_id = COALESCE(EXCLUDED.division_id, public.competition_entries.division_id),
        responded_by = v_uid,
        responded_at = now()
  RETURNING id INTO v_entry_id;

  RETURN QUERY SELECT v_comp_id, v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_competition_with_token(uuid, uuid, uuid) TO authenticated;
