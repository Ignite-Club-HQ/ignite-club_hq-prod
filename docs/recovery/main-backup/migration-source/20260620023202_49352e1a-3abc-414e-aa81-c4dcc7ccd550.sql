
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_tenant text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE public.competition_divisions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE public.competition_matches
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_home_team_id text,
  ADD COLUMN IF NOT EXISTS external_away_team_id text,
  ADD COLUMN IF NOT EXISTS home_team_name text,
  ADD COLUMN IF NOT EXISTS away_team_name text,
  ADD COLUMN IF NOT EXISTS manually_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS competitions_source_external_id_key
  ON public.competitions (source, external_id) WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS competition_divisions_source_external_id_key
  ON public.competition_divisions (source, external_id) WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS competition_matches_source_external_id_key
  ON public.competition_matches (source, external_id) WHERE external_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_external_competition_match_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service boolean := (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role';
BEGIN
  IF NEW.source IS DISTINCT FROM 'manual' AND NOT is_service THEN
    IF NEW.manually_overridden_at IS NOT NULL AND OLD.manually_overridden_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.manually_overridden_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.home_score    IS DISTINCT FROM OLD.home_score
    OR NEW.away_score    IS DISTINCT FROM OLD.away_score
    OR NEW.scheduled_at  IS DISTINCT FROM OLD.scheduled_at
    OR NEW.home_team_id  IS DISTINCT FROM OLD.home_team_id
    OR NEW.away_team_id  IS DISTINCT FROM OLD.away_team_id
    OR NEW.status        IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'This match is synced from % and cannot be edited directly. Set manually_overridden_at first to take local control.', NEW.source
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_external_match_edits ON public.competition_matches;
CREATE TRIGGER trg_guard_external_match_edits
  BEFORE UPDATE ON public.competition_matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_external_competition_match_edits();
