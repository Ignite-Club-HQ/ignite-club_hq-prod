-- True in-place move (no delete + re-insert window)
CREATE OR REPLACE FUNCTION public.move_event_group_player(
  p_player_id uuid,
  p_from_group_id uuid,
  p_to_group_id uuid,
  p_to_team text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_to_team IS NULL OR p_to_team NOT IN ('a','b') THEN
    RAISE EXCEPTION 'Invalid team value: %', p_to_team;
  END IF;

  UPDATE public.event_group_players
     SET group_id = p_to_group_id,
         team = p_to_team
   WHERE group_id = p_from_group_id
     AND player_id = p_player_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found in source group';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.move_event_group_player(uuid, uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_event_group_player(uuid, uuid, uuid, text) TO authenticated, service_role;

-- Swap as two in-place updates. (group_id, player_id) pairs cannot collide
-- because the two players are distinct, so no unique-violation window exists.
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
SET search_path = public
AS $$
BEGIN
  IF p_player1_team IS NOT NULL AND p_player1_team NOT IN ('a','b') THEN
    RAISE EXCEPTION 'Invalid team value: %', p_player1_team;
  END IF;
  IF p_player2_team IS NOT NULL AND p_player2_team NOT IN ('a','b') THEN
    RAISE EXCEPTION 'Invalid team value: %', p_player2_team;
  END IF;
  IF p_player1_id = p_player2_id THEN
    RAISE EXCEPTION 'Cannot swap a player with themselves';
  END IF;

  UPDATE public.event_group_players
     SET group_id = p_player2_group_id,
         team = p_player2_team
   WHERE group_id = p_player1_group_id
     AND player_id = p_player1_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found in group';
  END IF;

  UPDATE public.event_group_players
     SET group_id = p_player1_group_id,
         team = p_player1_team
   WHERE group_id = p_player2_group_id
     AND player_id = p_player2_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found in group';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) TO authenticated, service_role;

-- Atomic (re)generation of an event's groups + player assignments.
-- Invoker rights: every statement is still subject to Event Groups RLS.
CREATE OR REPLACE FUNCTION public.replace_event_groups(
  p_event_id uuid,
  p_groups jsonb,
  p_delete_existing boolean DEFAULT true
)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  g jsonb;
  p jsonb;
  new_id uuid;
  ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'event id is required';
  END IF;
  IF jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'groups payload must be a JSON array';
  END IF;

  IF p_delete_existing THEN
    DELETE FROM public.event_groups WHERE event_id = p_event_id;
  END IF;

  FOR g IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    INSERT INTO public.event_groups (
      event_id, name, ability_band, pitch_name, display_order,
      team_a_color, team_b_color
    )
    VALUES (
      p_event_id,
      COALESCE(g->>'name', 'Match'),
      NULLIF(g->>'ability_band', ''),
      NULLIF(g->>'pitch_name', ''),
      NULLIF(g->>'display_order', '')::int,
      NULLIF(g->>'team_a_color', ''),
      NULLIF(g->>'team_b_color', '')
    )
    RETURNING id INTO new_id;

    ids := ids || new_id;

    FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(g->'players', '[]'::jsonb))
    LOOP
      IF (p->>'team') IS NOT NULL AND (p->>'team') NOT IN ('a','b') THEN
        RAISE EXCEPTION 'Invalid team value: %', p->>'team';
      END IF;

      INSERT INTO public.event_group_players (group_id, player_id, team)
      VALUES (new_id, (p->>'player_id')::uuid, NULLIF(p->>'team', ''));
    END LOOP;
  END LOOP;

  RETURN ids;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_event_groups(uuid, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_groups(uuid, jsonb, boolean) TO authenticated, service_role;