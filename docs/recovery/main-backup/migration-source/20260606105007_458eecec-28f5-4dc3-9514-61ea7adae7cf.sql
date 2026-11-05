-- Shell team invites for competitions: invite teams not yet on Ignite

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS is_shell boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shell_contact_name text,
  ADD COLUMN IF NOT EXISTS shell_contact_email text,
  ADD COLUMN IF NOT EXISTS shell_claim_token uuid,
  ADD COLUMN IF NOT EXISTS shell_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shell_claimed_by uuid,
  ADD COLUMN IF NOT EXISTS shell_invited_by uuid,
  ADD COLUMN IF NOT EXISTS shell_last_invite_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_teams_shell_claim_token ON public.teams(shell_claim_token) WHERE shell_claim_token IS NOT NULL;

-- RPC: competition admin invites a brand-new team (not on app yet)
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  IF NOT public.is_competition_admin(p_competition_id, v_uid) THEN
    RAISE EXCEPTION 'not_competition_admin';
  END IF;
  IF v_team_name = '' THEN RAISE EXCEPTION 'team_name_required'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;

  -- Create a shell club for this invited team (always its own shell so claim flow is isolated)
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

-- RPC: claim a shell team via token (run after sign-in)
CREATE OR REPLACE FUNCTION public.claim_shell_team(p_token uuid)
RETURNS TABLE(team_id uuid, club_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT t.id, t.club_id, t.is_shell, t.shell_claimed_at
    INTO v_team
  FROM public.teams t
  WHERE t.shell_claim_token = p_token
  LIMIT 1;

  IF v_team.id IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF v_team.shell_claimed_at IS NOT NULL THEN
    -- Idempotent: still grant team_admin if missing, return existing ids
    INSERT INTO public.user_roles (user_id, role, club_id, team_id)
    VALUES (v_uid, 'team_admin', v_team.club_id, v_team.id)
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT v_team.id, v_team.club_id;
    RETURN;
  END IF;

  UPDATE public.teams
     SET is_shell = false,
         shell_claimed_at = now(),
         shell_claimed_by = v_uid,
         shell_claim_token = NULL
   WHERE id = v_team.id;

  INSERT INTO public.user_roles (user_id, role, club_id, team_id)
  VALUES (v_uid, 'team_admin', v_team.club_id, v_team.id)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT v_team.id, v_team.club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_shell_team(uuid) TO authenticated;