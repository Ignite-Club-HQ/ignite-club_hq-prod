
CREATE OR REPLACE FUNCTION public.create_personal_competition(
  p_name text,
  p_description text DEFAULT NULL,
  p_sport text DEFAULT NULL,
  p_season text DEFAULT NULL,
  p_visibility text DEFAULT 'private',
  p_shell_name text DEFAULT NULL
)
RETURNS TABLE (competition_id uuid, club_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_desc text;
  v_sport text;
  v_season text;
  v_shell_name text;
  v_visibility text;
  v_club_id uuid;
  v_competition_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'competition_name_required' USING ERRCODE = '22023';
  END IF;

  v_visibility := lower(btrim(coalesce(p_visibility, 'private')));
  IF v_visibility NOT IN ('private', 'unlisted', 'public') THEN
    RAISE EXCEPTION 'invalid_visibility' USING ERRCODE = '22023';
  END IF;

  v_desc       := NULLIF(btrim(coalesce(p_description, '')), '');
  v_sport      := NULLIF(btrim(coalesce(p_sport, '')), '');
  v_season     := NULLIF(btrim(coalesce(p_season, '')), '');
  v_shell_name := NULLIF(btrim(coalesce(p_shell_name, '')), '');
  IF v_shell_name IS NULL THEN
    v_shell_name := 'My competitions';
  END IF;

  INSERT INTO public.clubs (name, kind, created_by)
  VALUES (v_shell_name, 'shell', v_user)
  RETURNING id INTO v_club_id;

  INSERT INTO public.user_roles (user_id, club_id, role)
  VALUES (v_user, v_club_id, 'club_admin');

  INSERT INTO public.competitions (
    name, description, sport, season, organizer_club_id,
    visibility, status, created_by
  )
  VALUES (
    v_name, v_desc, v_sport, v_season, v_club_id,
    v_visibility, 'draft', v_user
  )
  RETURNING id INTO v_competition_id;

  competition_id := v_competition_id;
  club_id := v_club_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_personal_competition(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_personal_competition(text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_personal_competition(text, text, text, text, text, text) TO authenticated;
