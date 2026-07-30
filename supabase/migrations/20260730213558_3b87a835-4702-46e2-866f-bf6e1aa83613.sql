-- 0. Safety gate: refuse to apply if duplicates already exist.
DO $$
DECLARE
  v_pairs int;
  v_rows  int;
BEGIN
  SELECT count(*), COALESCE(sum(c), 0)
    INTO v_pairs, v_rows
  FROM (
    SELECT eg.event_id, egp.player_id, count(*) AS c
    FROM public.event_group_players egp
    JOIN public.event_groups eg ON eg.id = egp.group_id
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) d;

  IF v_pairs > 0 THEN
    RAISE EXCEPTION
      'Aborting: % duplicate event/player pair(s) covering % assignment row(s) must be remediated before the strict invariant can be enforced.',
      v_pairs, v_rows;
  END IF;
END $$;

-- 1. Composite key on the parent so children can reference (id, event_id) together.
ALTER TABLE public.event_groups
  ADD CONSTRAINT event_groups_id_event_id_key UNIQUE (id, event_id);

-- 2. Denormalised event reference on the assignment row.
ALTER TABLE public.event_group_players
  ADD COLUMN IF NOT EXISTS event_id uuid;

UPDATE public.event_group_players egp
   SET event_id = eg.event_id
  FROM public.event_groups eg
 WHERE eg.id = egp.group_id
   AND egp.event_id IS DISTINCT FROM eg.event_id;

ALTER TABLE public.event_group_players
  ALTER COLUMN event_id SET NOT NULL;

-- 3. Composite FK guarantees event_id always matches the owning group,
--    even if triggers are disabled. Group moved to another event -> cascades.
ALTER TABLE public.event_group_players
  ADD CONSTRAINT event_group_players_group_event_fkey
  FOREIGN KEY (group_id, event_id)
  REFERENCES public.event_groups (id, event_id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

-- 4. The authoritative, bypass-proof invariant.
ALTER TABLE public.event_group_players
  ADD CONSTRAINT event_group_players_event_id_player_id_key UNIQUE (event_id, player_id);

-- 5. Trigger now also derives event_id (never trusts a client-supplied value)
--    and retains the friendly conflict message for the normal app path.
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
  SELECT eg.event_id INTO v_event_id
  FROM public.event_groups eg
  WHERE eg.id = NEW.group_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid destination match group'
      USING ERRCODE = '23503';
  END IF;

  -- Always derived; any value supplied by the caller is discarded.
  NEW.event_id := v_event_id;

  IF NEW.player_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_event_id::text),
    hashtext(NEW.player_id::text)
  );

  SELECT egp.id INTO v_conflict_id
  FROM public.event_group_players egp
  WHERE egp.event_id = v_event_id
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
BEFORE INSERT OR UPDATE OF group_id, player_id, event_id ON public.event_group_players
FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_event_player_assignment();