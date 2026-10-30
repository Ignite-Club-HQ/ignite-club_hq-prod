-- Concurrency-safe invariant: within one event, a player may appear in at most one event_group_players row.

CREATE OR REPLACE FUNCTION public.enforce_unique_event_player_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_id uuid;
  v_conflict_id uuid;
BEGIN
  IF NEW.player_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT eg.event_id INTO v_event_id
  FROM public.event_groups eg
  WHERE eg.id = NEW.group_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid destination match group'
      USING ERRCODE = '23503';
  END IF;

  -- Serialise concurrent writers for this (event, player) pair.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_event_id::text, 0),
    hashtextextended(NEW.player_id::text, 0)
  );

  SELECT egp.id INTO v_conflict_id
  FROM public.event_group_players egp
  JOIN public.event_groups eg2 ON eg2.id = egp.group_id
  WHERE eg2.event_id = v_event_id
    AND egp.player_id = NEW.player_id
    AND egp.id IS DISTINCT FROM NEW.id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Player is already assigned to another match in this event'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_unique_event_player_assignment() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_enforce_unique_event_player_assignment ON public.event_group_players;
CREATE TRIGGER trg_enforce_unique_event_player_assignment
BEFORE INSERT OR UPDATE OF group_id, player_id ON public.event_group_players
FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_event_player_assignment();

-- Harden replace_event_groups with payload-level duplicate detection.
CREATE OR REPLACE FUNCTION public.replace_event_groups(p_event_id uuid, p_groups jsonb, p_delete_existing boolean DEFAULT true)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  g jsonb;
  p jsonb;
  new_id uuid;
  ids uuid[] := ARRAY[]::uuid[];
  payload_players uuid[] := ARRAY[]::uuid[];
  dup_count int;
  clash_count int;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'event id is required';
  END IF;
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'groups payload must be a JSON array';
  END IF;

  -- Collect every non-null player id across the payload.
  SELECT COALESCE(array_agg((pl->>'player_id')::uuid), ARRAY[]::uuid[])
    INTO payload_players
  FROM jsonb_array_elements(p_groups) grp
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(grp->'players', '[]'::jsonb)) pl
  WHERE NULLIF(pl->>'player_id', '') IS NOT NULL;

  -- Reject duplicates inside the payload itself.
  SELECT count(*) INTO dup_count
  FROM (
    SELECT pid FROM unnest(payload_players) pid GROUP BY pid HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Player is already assigned to another match in this event'
      USING ERRCODE = '23505';
  END IF;

  -- Serialise concurrent replacements for this event/player set.
  IF array_length(payload_players, 1) > 0 THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_event_id::text, 0),
      hashtextextended(pid::text, 0)
    )
    FROM (SELECT DISTINCT pid FROM unnest(payload_players) pid ORDER BY 1) s;
  END IF;

  IF p_delete_existing THEN
    DELETE FROM public.event_groups WHERE event_id = p_event_id;
  ELSE
    -- Keeping existing groups: reject any payload player already allocated in this event.
    SELECT count(*) INTO clash_count
    FROM public.event_group_players egp
    JOIN public.event_groups eg ON eg.id = egp.group_id
    WHERE eg.event_id = p_event_id
      AND egp.player_id = ANY (payload_players);

    IF clash_count > 0 THEN
      RAISE EXCEPTION 'Player is already assigned to another match in this event'
        USING ERRCODE = '23505';
    END IF;
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
$function$;