-- 1. Write-frequency log for active_games. One row per write (insert OR update),
--    tagged so we can answer "which team / which coach is writing too much?".
CREATE TABLE public.active_games_write_log (
  id BIGSERIAL PRIMARY KEY,
  active_game_id UUID NOT NULL,
  user_id UUID NOT NULL,
  team_id UUID,
  op TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index tuned for the alert query: count writes in the last minute per team.
CREATE INDEX idx_aglog_team_recent
  ON public.active_games_write_log (team_id, created_at DESC)
  WHERE team_id IS NOT NULL;

-- Index for the per-user view (admin debugging).
CREATE INDEX idx_aglog_user_recent
  ON public.active_games_write_log (user_id, created_at DESC);

-- Lock down access. Only app admins read; the trigger inserts via SECURITY DEFINER.
ALTER TABLE public.active_games_write_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view write log"
  ON public.active_games_write_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'));

-- 2. Trigger function: records every write and raises an alert on storms.
CREATE OR REPLACE FUNCTION public.log_active_game_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
  last_alert_at TIMESTAMPTZ;
  STORM_THRESHOLD CONSTANT INT := 30; -- writes/minute. Normal is ~6/min.
  ALERT_COOLDOWN_MIN CONSTANT INT := 10;
BEGIN
  -- Always record the write. Best-effort — never block the live game on this.
  BEGIN
    INSERT INTO public.active_games_write_log (active_game_id, user_id, team_id, op)
    VALUES (NEW.id, NEW.user_id, NEW.team_id, TG_OP);
  EXCEPTION WHEN OTHERS THEN
    -- Swallow logging failures so a broken log table never breaks game sync.
    RETURN NEW;
  END;

  -- Storm detection only makes sense per-team. Skip team-less rows.
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- How many writes for this team in the last minute?
  SELECT COUNT(*)
    INTO recent_count
    FROM public.active_games_write_log
   WHERE team_id = NEW.team_id
     AND created_at > now() - INTERVAL '1 minute';

  IF recent_count < STORM_THRESHOLD THEN
    RETURN NEW;
  END IF;

  -- Throttle alerts: only one per team per cooldown window.
  SELECT MAX(created_at)
    INTO last_alert_at
    FROM public.admin_alerts
   WHERE alert_type = 'active_games_write_storm'
     AND (details->>'team_id')::uuid = NEW.team_id;

  IF last_alert_at IS NOT NULL
     AND last_alert_at > now() - make_interval(mins => ALERT_COOLDOWN_MIN) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_alerts (alert_type, details)
  VALUES (
    'active_games_write_storm',
    jsonb_build_object(
      'team_id', NEW.team_id,
      'user_id', NEW.user_id,
      'active_game_id', NEW.id,
      'writes_in_last_minute', recent_count,
      'threshold', STORM_THRESHOLD,
      'detected_at', now()
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_active_game_write
  AFTER INSERT OR UPDATE ON public.active_games
  FOR EACH ROW
  EXECUTE FUNCTION public.log_active_game_write();

-- 3. Hourly auto-prune so the log table stays small.
CREATE OR REPLACE FUNCTION public.prune_active_games_write_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.active_games_write_log
   WHERE created_at < now() - INTERVAL '1 hour';
END;
$$;