
-- Create a secure RPC that lets any authenticated team member get or create a player invite token
CREATE OR REPLACE FUNCTION public.get_or_create_member_invite_token(p_team_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  -- Verify caller is a member of this team
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this team';
  END IF;

  -- Try to reuse existing player invite
  SELECT token INTO v_token
  FROM public.team_invites
  WHERE team_id = p_team_id
    AND role = 'player'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Create one if none exists
  IF v_token IS NULL THEN
    v_token := gen_random_uuid()::text;
    INSERT INTO public.team_invites (team_id, role, token, created_by)
    VALUES (p_team_id, 'player', v_token, auth.uid());
  END IF;

  RETURN v_token;
END;
$$;
