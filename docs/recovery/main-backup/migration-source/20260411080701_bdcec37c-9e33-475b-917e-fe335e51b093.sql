-- Make all overloads of get_or_create_member_invite_token SECURITY DEFINER
-- so they bypass RLS (they already validate membership internally)

CREATE OR REPLACE FUNCTION public.get_or_create_member_invite_token(p_team_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this team';
  END IF;

  SELECT token INTO v_token
  FROM public.team_invites
  WHERE team_id = p_team_id
    AND role = 'player'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_token IS NULL THEN
    v_token := gen_random_uuid()::text;
    INSERT INTO public.team_invites (team_id, role, token, created_by)
    VALUES (p_team_id, 'player', v_token, auth.uid());
  END IF;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_member_invite_token(p_team_id uuid, p_role app_role DEFAULT 'player'::app_role)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this team';
  END IF;

  IF p_role NOT IN ('player', 'coach', 'parent', 'team_admin') THEN
    RAISE EXCEPTION 'Invalid role for team invite';
  END IF;

  SELECT token INTO v_token
  FROM public.team_invites
  WHERE team_id = p_team_id
    AND role = p_role
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_token IS NULL THEN
    v_token := gen_random_uuid()::text;
    INSERT INTO public.team_invites (team_id, role, token, created_by)
    VALUES (p_team_id, p_role, v_token, auth.uid());
  END IF;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_member_invite_token(p_team_id uuid, p_role app_role DEFAULT 'player'::app_role, p_child_name text DEFAULT NULL, p_child_year_of_birth integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this team';
  END IF;

  IF p_role NOT IN ('player', 'coach', 'parent', 'team_admin') THEN
    RAISE EXCEPTION 'Invalid role for team invite';
  END IF;

  IF p_role = 'parent' AND p_child_name IS NOT NULL AND p_child_name <> '' THEN
    v_token := gen_random_uuid()::text;
    INSERT INTO public.team_invites (team_id, role, token, created_by, max_uses, metadata)
    VALUES (
      p_team_id, 
      p_role, 
      v_token, 
      auth.uid(),
      1,
      jsonb_build_object(
        'child_name', p_child_name,
        'child_year_of_birth', p_child_year_of_birth
      )
    );
    RETURN v_token;
  END IF;

  SELECT token INTO v_token
  FROM public.team_invites
  WHERE team_id = p_team_id
    AND role = p_role
    AND metadata IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_token IS NULL THEN
    v_token := gen_random_uuid()::text;
    INSERT INTO public.team_invites (team_id, role, token, created_by)
    VALUES (p_team_id, p_role, v_token, auth.uid());
  END IF;

  RETURN v_token;
END;
$$;