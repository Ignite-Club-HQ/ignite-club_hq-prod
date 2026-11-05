
-- 1) Backfill child_id on existing rsvps that have a linked mini_league_player_id
UPDATE public.rsvps r
SET child_id = mlp.child_id
FROM public.mini_league_players mlp
WHERE r.mini_league_player_id = mlp.id
  AND mlp.child_id IS NOT NULL
  AND r.child_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.rsvps r2
    WHERE r2.event_id = r.event_id
      AND r2.child_id = mlp.child_id
      AND r2.id <> r.id
  );

-- 2) Delete duplicate mlp-only rsvps where a child rsvp already exists for the same event+child
DELETE FROM public.rsvps r
USING public.mini_league_players mlp, public.rsvps keep
WHERE r.mini_league_player_id = mlp.id
  AND mlp.child_id IS NOT NULL
  AND r.child_id IS NULL
  AND keep.event_id = r.event_id
  AND keep.child_id = mlp.child_id
  AND keep.id <> r.id;

-- 3) Trigger to auto-fill child_id from mini_league_players on future inserts/updates
CREATE OR REPLACE FUNCTION public.rsvps_fill_child_from_mlp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child uuid;
BEGIN
  IF NEW.mini_league_player_id IS NOT NULL AND NEW.child_id IS NULL THEN
    SELECT child_id INTO v_child
    FROM public.mini_league_players
    WHERE id = NEW.mini_league_player_id;
    IF v_child IS NOT NULL THEN
      NEW.child_id := v_child;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rsvps_fill_child_from_mlp ON public.rsvps;
CREATE TRIGGER trg_rsvps_fill_child_from_mlp
BEFORE INSERT OR UPDATE ON public.rsvps
FOR EACH ROW
EXECUTE FUNCTION public.rsvps_fill_child_from_mlp();
