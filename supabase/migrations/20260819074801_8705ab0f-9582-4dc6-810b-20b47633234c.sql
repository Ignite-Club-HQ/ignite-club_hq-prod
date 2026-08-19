DO $mig$
DECLARE
  def text;
  new_def text;
  membership_old text := 'WHEN ''membership'', ''role_removed'' THEN notification_url := ''/notifications'';';
  membership_new text := $repl$WHEN 'membership', 'role_removed' THEN
      BEGIN
        IF msg_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.teams WHERE id = msg_id::uuid) THEN
          SELECT t.club_id INTO club_id_val FROM public.teams t WHERE t.id = msg_id::uuid;
          team_id_val := msg_id::uuid;
          notification_url := '/teams/' || msg_id;
        ELSIF msg_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs WHERE id = msg_id::uuid) THEN
          club_id_val := msg_id::uuid;
          notification_url := '/clubs/' || msg_id;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;$repl$;
  anchor_old text := '  -- Per-message tag so concurrent unread notifications don''t collapse on Android';
  anchor_new text := $anch$  -- Backfill the owning club for membership-style notifications so the app can
  -- switch the active club filter when the user taps the push. Without this a
  -- tap lands on the target route while the app stays filtered to the club that
  -- happened to be selected last.
  IF club_id_val IS NULL AND team_id_val IS NOT NULL THEN
    BEGIN
      SELECT t.club_id INTO club_id_val FROM public.teams t WHERE t.id = team_id_val;
    EXCEPTION WHEN OTHERS THEN
      club_id_val := club_id_val;
    END;
  END IF;

  IF NEW.club_id IS NULL AND club_id_val IS NOT NULL THEN
    NEW.club_id := club_id_val;
  END IF;

  -- Per-message tag so concurrent unread notifications don't collapse on Android$anch$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'compute_push_notification_url';

  IF def IS NULL THEN
    RAISE EXCEPTION 'compute_push_notification_url not found';
  END IF;

  IF position(membership_old in def) = 0 THEN
    RAISE EXCEPTION 'membership branch anchor not found';
  END IF;
  IF position(anchor_old in def) = 0 THEN
    RAISE EXCEPTION 'tag anchor not found';
  END IF;

  new_def := replace(def, membership_old, membership_new);
  new_def := replace(new_def, anchor_old, anchor_new);

  EXECUTE new_def;
END
$mig$;