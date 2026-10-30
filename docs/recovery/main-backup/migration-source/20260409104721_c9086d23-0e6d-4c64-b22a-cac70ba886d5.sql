
-- Add metadata column to team_invites
ALTER TABLE public.team_invites ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT NULL;

-- Update the RPC to support optional child metadata for parent invites
CREATE OR REPLACE FUNCTION public.get_or_create_member_invite_token(
  p_team_id uuid,
  p_role app_role DEFAULT 'player',
  p_child_name text DEFAULT NULL,
  p_child_year_of_birth int DEFAULT NULL
)
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

  -- Only allow specific roles
  IF p_role NOT IN ('player', 'coach', 'parent', 'team_admin') THEN
    RAISE EXCEPTION 'Invalid role for team invite';
  END IF;

  -- If child info is provided (parent invite with child), always create a fresh single-use token
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

  -- Try to reuse existing invite for this team+role combo (no child metadata)
  SELECT token INTO v_token
  FROM public.team_invites
  WHERE team_id = p_team_id
    AND role = p_role
    AND metadata IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  -- Create one if none exists
  IF v_token IS NULL THEN
    v_token := gen_random_uuid()::text;
    INSERT INTO public.team_invites (team_id, role, token, created_by)
    VALUES (p_team_id, p_role, v_token, auth.uid());
  END IF;

  RETURN v_token;
END;
$$;
