-- Scope subscription_renewal_reminder notifications to their owning club (real triggers).
--
-- The earlier migration edited compute_push_notification_url, which is legacy
-- and not attached to any trigger. The live path is:
--   BEFORE INSERT: set_notification_club_id -> derive_notification_club_id
--   AFTER INSERT:  send_push_notification (builds push url + payload club_id)
-- Neither handled 'subscription_renewal_reminder', so rows kept club_id NULL
-- (leaking into other clubs' bell) and pushes carried no club_id/url.

-- 1) derive_notification_club_id: resolve team -> club, else club directly.
DO $mig$
DECLARE
  def text;
  new_def text;
  anchor_old text := 'WHEN _type IN (''member_joined'',''membership'',''team_invite'') THEN';
  anchor_new text := 'WHEN _type IN (''member_joined'',''membership'',''team_invite'',''subscription_renewal_reminder'') THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'derive_notification_club_id';
  IF def IS NULL THEN
    RAISE EXCEPTION 'derive_notification_club_id not found';
  END IF;
  IF position(anchor_old in def) = 0 THEN
    RAISE EXCEPTION 'derive anchor not found';
  END IF;
  new_def := replace(def, anchor_old, anchor_new);
  EXECUTE new_def;
END
$mig$;

-- 2) send_push_notification: route the tap to the team or club page and put
--    club_id / team_id into the push payload so the app can switch the active
--    club filter on tap.
DO $mig$
DECLARE
  def text;
  new_def text;
  anchor_old text := $a$WHEN 'subscription_expiring','subscription_expired','subscription_renewed','storage_limit' THEN
      notification_url := '/account';$a$;
  anchor_new text := $r$WHEN 'subscription_renewal_reminder' THEN
      -- related_id is team_id for team subscriptions, club_id for club ones.
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
      END;

    WHEN 'subscription_expiring','subscription_expired','subscription_renewed','storage_limit' THEN
      notification_url := '/account';$r$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'send_push_notification';
  IF def IS NULL THEN
    RAISE EXCEPTION 'send_push_notification not found';
  END IF;
  IF position(anchor_old in def) = 0 THEN
    RAISE EXCEPTION 'subscription branch anchor not found';
  END IF;
  new_def := replace(def, anchor_old, anchor_new);
  EXECUTE new_def;
END
$mig$;