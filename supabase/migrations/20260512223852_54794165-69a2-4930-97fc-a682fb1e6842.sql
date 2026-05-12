
-- RSVP audit log
CREATE TABLE public.rsvp_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rsvp_id uuid,
  event_id uuid NOT NULL,
  club_id uuid,
  team_id uuid,
  mini_league_id uuid,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  old_status text,
  new_status text,
  actor_user_id uuid,
  subject_user_id uuid,
  subject_child_id uuid,
  subject_mini_league_player_id uuid,
  subject_kind text NOT NULL CHECK (subject_kind IN ('self','parent_for_user','parent_for_child','parent_for_league_player','admin_override')),
  subject_label text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rsvp_audit_log_event ON public.rsvp_audit_log(event_id, created_at DESC);
CREATE INDEX idx_rsvp_audit_log_mini_league ON public.rsvp_audit_log(mini_league_id, created_at DESC) WHERE mini_league_id IS NOT NULL;
CREATE INDEX idx_rsvp_audit_log_actor ON public.rsvp_audit_log(actor_user_id, created_at DESC);

ALTER TABLE public.rsvp_audit_log ENABLE ROW LEVEL SECURITY;

-- Viewers: app_admin, club_admin, league_admin, mini_league_admins, team_admin/coach for the event scope, OR the actor themselves
CREATE POLICY "Audit log viewable by event admins or actor"
ON public.rsvp_audit_log
FOR SELECT
TO authenticated
USING (
  actor_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'app_admin'::public.app_role)
  OR (
    club_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.club_id = rsvp_audit_log.club_id
        AND ur.role IN ('club_admin'::public.app_role, 'committee_member'::public.app_role)
    )
  )
  OR (
    team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.team_id = rsvp_audit_log.team_id
        AND ur.role IN ('team_admin'::public.app_role, 'coach'::public.app_role)
    )
  )
  OR (
    mini_league_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.mini_league_admins mla
        WHERE mla.mini_league_id = rsvp_audit_log.mini_league_id
          AND mla.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.club_id = rsvp_audit_log.club_id
          AND ur.role = 'league_admin'::public.app_role
      )
    )
  )
);

-- Inserts only via trigger (service role / definer); block direct client writes
CREATE POLICY "No direct inserts"
ON public.rsvp_audit_log
FOR INSERT
TO authenticated
WITH CHECK (false);

-- Trigger function
CREATE OR REPLACE FUNCTION public.log_rsvp_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_actor uuid;
  v_kind text;
  v_label text;
  v_subject_user uuid;
  v_subject_child uuid;
  v_subject_mlp uuid;
  v_action text;
  v_old_status text;
  v_new_status text;
  v_rsvp_id uuid;
  v_source text;
BEGIN
  v_actor := auth.uid();

  IF (TG_OP = 'DELETE') THEN
    v_action := 'delete';
    v_old_status := OLD.status::text;
    v_new_status := NULL;
    v_rsvp_id := OLD.id;
    v_subject_user := OLD.user_id;
    v_subject_child := OLD.child_id;
    v_subject_mlp := OLD.mini_league_player_id;
    v_source := OLD.source;
    SELECT id, club_id, team_id, mini_league_id INTO v_event FROM public.events WHERE id = OLD.event_id;
  ELSIF (TG_OP = 'INSERT') THEN
    v_action := 'insert';
    v_old_status := NULL;
    v_new_status := NEW.status::text;
    v_rsvp_id := NEW.id;
    v_subject_user := NEW.user_id;
    v_subject_child := NEW.child_id;
    v_subject_mlp := NEW.mini_league_player_id;
    v_source := NEW.source;
    SELECT id, club_id, team_id, mini_league_id INTO v_event FROM public.events WHERE id = NEW.event_id;
  ELSE
    -- UPDATE: only log when status changed
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
    v_action := 'update';
    v_old_status := OLD.status::text;
    v_new_status := NEW.status::text;
    v_rsvp_id := NEW.id;
    v_subject_user := NEW.user_id;
    v_subject_child := NEW.child_id;
    v_subject_mlp := NEW.mini_league_player_id;
    v_source := NEW.source;
    SELECT id, club_id, team_id, mini_league_id INTO v_event FROM public.events WHERE id = NEW.event_id;
  END IF;

  -- Determine subject kind + label
  IF v_subject_mlp IS NOT NULL THEN
    v_kind := 'parent_for_league_player';
    SELECT name INTO v_label FROM public.mini_league_players WHERE id = v_subject_mlp;
  ELSIF v_subject_child IS NOT NULL THEN
    v_kind := 'parent_for_child';
    SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',COALESCE(last_name,''))),''), 'Child')
      INTO v_label FROM public.children WHERE id = v_subject_child;
  ELSIF v_subject_user IS NOT NULL THEN
    IF v_actor IS NOT NULL AND v_actor = v_subject_user THEN
      v_kind := 'self';
    ELSE
      v_kind := 'admin_override';
    END IF;
    SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',COALESCE(last_name,''))),''), 'Player')
      INTO v_label FROM public.profiles WHERE id = v_subject_user;
  ELSE
    v_kind := 'admin_override';
    v_label := NULL;
  END IF;

  INSERT INTO public.rsvp_audit_log (
    rsvp_id, event_id, club_id, team_id, mini_league_id,
    action, old_status, new_status,
    actor_user_id, subject_user_id, subject_child_id, subject_mini_league_player_id,
    subject_kind, subject_label, source
  ) VALUES (
    v_rsvp_id, COALESCE(NEW.event_id, OLD.event_id), v_event.club_id, v_event.team_id, v_event.mini_league_id,
    v_action, v_old_status, v_new_status,
    v_actor, v_subject_user, v_subject_child, v_subject_mlp,
    v_kind, v_label, v_source
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Never break the underlying RSVP write because of audit log issues
  RAISE WARNING '[rsvp_audit_log] failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_rsvp_change ON public.rsvps;
CREATE TRIGGER trg_log_rsvp_change
AFTER INSERT OR UPDATE OR DELETE ON public.rsvps
FOR EACH ROW EXECUTE FUNCTION public.log_rsvp_change();
