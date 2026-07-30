CREATE OR REPLACE FUNCTION public.swap_event_group_players(
  p_player1_id uuid,
  p_player1_group_id uuid,
  p_player1_team text,
  p_player2_id uuid,
  p_player2_group_id uuid,
  p_player2_team text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_player1_team IS NOT NULL AND p_player1_team NOT IN ('a','b') THEN
    RAISE EXCEPTION 'Invalid team value: %', p_player1_team;
  END IF;
  IF p_player2_team IS NOT NULL AND p_player2_team NOT IN ('a','b') THEN
    RAISE EXCEPTION 'Invalid team value: %', p_player2_team;
  END IF;

  IF p_player1_group_id = p_player2_group_id THEN
    UPDATE public.event_group_players
      SET team = p_player2_team
      WHERE group_id = p_player1_group_id AND player_id = p_player1_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Player not found in group';
    END IF;

    UPDATE public.event_group_players
      SET team = p_player1_team
      WHERE group_id = p_player2_group_id AND player_id = p_player2_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Player not found in group';
    END IF;
  ELSE
    DELETE FROM public.event_group_players
      WHERE group_id = p_player1_group_id AND player_id = p_player1_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Player not found in group';
    END IF;

    DELETE FROM public.event_group_players
      WHERE group_id = p_player2_group_id AND player_id = p_player2_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Player not found in group';
    END IF;

    INSERT INTO public.event_group_players (group_id, player_id, team)
      VALUES (p_player2_group_id, p_player1_id, p_player2_team);

    INSERT INTO public.event_group_players (group_id, player_id, team)
      VALUES (p_player1_group_id, p_player2_id, p_player1_team);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) TO service_role;