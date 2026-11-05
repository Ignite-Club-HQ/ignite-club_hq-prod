
CREATE OR REPLACE FUNCTION public.claim_mini_league_invite(_token uuid)
RETURNS TABLE(child_id uuid, mini_league_id uuid, club_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_invite pending_invites%ROWTYPE;
  v_meta jsonb;
  v_child uuid;
  v_league uuid;
  v_player uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invite
  FROM pending_invites
  WHERE invite_token = _token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'Invite already used';
  END IF;

  IF v_invite.role <> 'parent' THEN
    RAISE EXCEPTION 'Not a parent invite';
  END IF;

  -- Recipient must match (by user id or email)
  IF NOT (
    v_invite.invited_user_id = v_user
    OR (v_invite.invited_email IS NOT NULL AND user_email_matches_invite(v_user, v_invite.invited_email))
  ) THEN
    RAISE EXCEPTION 'Invite is not addressed to this account';
  END IF;

  v_meta := COALESCE(v_invite.metadata, '{}'::jsonb);
  v_child := NULLIF(v_meta->>'child_id', '')::uuid;
  v_league := NULLIF(v_meta->>'mini_league_id', '')::uuid;
  v_player := NULLIF(v_meta->>'player_id', '')::uuid;

  IF v_child IS NULL OR v_league IS NULL THEN
    RAISE EXCEPTION 'Invite missing child/league info';
  END IF;

  -- Transfer child ownership to the new parent
  UPDATE children SET parent_id = v_user WHERE id = v_child;

  -- Ensure league assignment exists
  INSERT INTO child_mini_league_assignments (child_id, mini_league_id, ability_rating)
  VALUES (v_child, v_league, 3)
  ON CONFLICT DO NOTHING;

  -- Update legacy player row
  IF v_player IS NOT NULL THEN
    UPDATE mini_league_players SET parent_user_id = v_user WHERE id = v_player;
  ELSE
    UPDATE mini_league_players
       SET parent_user_id = v_user
     WHERE child_id = v_child AND mini_league_id = v_league;
  END IF;

  -- Mark invite accepted
  UPDATE pending_invites
     SET status = 'accepted',
         accepted_at = now(),
         invited_user_id = v_user
   WHERE id = v_invite.id;

  RETURN QUERY SELECT v_child, v_league, v_invite.club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_mini_league_invite(uuid) TO authenticated;
