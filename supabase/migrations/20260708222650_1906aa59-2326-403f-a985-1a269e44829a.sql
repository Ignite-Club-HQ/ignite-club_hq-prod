
-- 1. Audit table
CREATE TABLE IF NOT EXISTS public.write_audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  row_id TEXT,
  row_data JSONB NOT NULL,
  old_data JSONB,
  actor_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS write_audit_log_occurred_at_idx ON public.write_audit_log (occurred_at);
CREATE INDEX IF NOT EXISTS write_audit_log_table_time_idx ON public.write_audit_log (table_name, occurred_at);

GRANT SELECT, INSERT ON public.write_audit_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.write_audit_log_id_seq TO authenticated;
GRANT ALL ON public.write_audit_log TO service_role;
GRANT ALL ON SEQUENCE public.write_audit_log_id_seq TO service_role;

ALTER TABLE public.write_audit_log ENABLE ROW LEVEL SECURITY;

-- Only app_admin can read the audit log; inserts happen via SECURITY DEFINER trigger so no INSERT policy needed for users
CREATE POLICY "App admins can view write audit log"
  ON public.write_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'));

-- 2. Generic trigger function
CREATE OR REPLACE FUNCTION public.write_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id TEXT;
  v_actor UUID;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    BEGIN
      v_row_id := (to_jsonb(OLD)->>'id');
    EXCEPTION WHEN OTHERS THEN
      v_row_id := NULL;
    END;
    INSERT INTO public.write_audit_log (table_name, operation, row_id, row_data, old_data, actor_id)
    VALUES (TG_TABLE_NAME, 'DELETE', v_row_id, to_jsonb(OLD), NULL, v_actor);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    BEGIN
      v_row_id := (to_jsonb(NEW)->>'id');
    EXCEPTION WHEN OTHERS THEN
      v_row_id := NULL;
    END;
    INSERT INTO public.write_audit_log (table_name, operation, row_id, row_data, old_data, actor_id)
    VALUES (TG_TABLE_NAME, 'UPDATE', v_row_id, to_jsonb(NEW), to_jsonb(OLD), v_actor);
    RETURN NEW;
  ELSE
    BEGIN
      v_row_id := (to_jsonb(NEW)->>'id');
    EXCEPTION WHEN OTHERS THEN
      v_row_id := NULL;
    END;
    INSERT INTO public.write_audit_log (table_name, operation, row_id, row_data, old_data, actor_id)
    VALUES (TG_TABLE_NAME, 'INSERT', v_row_id, to_jsonb(NEW), NULL, v_actor);
    RETURN NEW;
  END IF;
END;
$$;

-- 3. Helper to attach trigger to any table
CREATE OR REPLACE FUNCTION public.attach_write_audit(p_table TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS zz_write_audit ON public.%I', p_table);
  EXECUTE format(
    'CREATE TRIGGER zz_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit_trigger()',
    p_table
  );
END;
$$;

-- 4. Attach triggers to critical tables
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'events','rsvps','event_payments','event_guests','event_groups','event_group_players','event_group_duties',
    'teams','clubs','team_memberships','club_players','children','child_guardians',
    'club_messages','team_messages','group_messages','direct_messages','chat_groups',
    'photos','photo_albums','photo_comments','photo_reactions',
    'competitions','competition_matches','competition_entries','game_results','game_player_stats',
    'mini_leagues','mini_league_sessions','mini_league_players','mini_league_session_availability',
    'class_enrolments','class_attendance',
    'profiles','user_roles','notification_preferences',
    'vault_folders','vault_files','vault_drive_links',
    'polls','poll_options','poll_votes',
    'eoi_submissions','member_referrals','member_subscription_payments','iap_transactions',
    'drills','training_session_drills','event_session_drills'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      PERFORM public.attach_write_audit(t);
    END IF;
  END LOOP;
END $$;

-- 5. Retention: prune audit rows older than 30 days
CREATE OR REPLACE FUNCTION public.prune_write_audit_log()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  DELETE FROM public.write_audit_log WHERE occurred_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
