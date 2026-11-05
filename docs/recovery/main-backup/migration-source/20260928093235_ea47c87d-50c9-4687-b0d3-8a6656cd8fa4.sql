-- Scope subscription_renewal_reminder notifications to their owning club.
--
-- These rows are inserted by the send-renewal-reminders edge function with
-- related_id = team_id (team subs) or club_id (club subs), but the push
-- trigger had no branch for the type, so url fell through to '/notifications'
-- and club_id stayed NULL. Result: the bell showed a Basket Range renewal
-- while filtered to Bridgewater, and tapping the push could not switch clubs.
--
-- 1) Add a dedicated branch to compute_push_notification_url that resolves
--    team-vs-club, sets club_id_val/team_id_val (the existing backfill then
--    stamps NEW.club_id and the push payload carries club_id), and routes the
--    tap to the team or club page.
-- 2) Backfill club_id on existing renewal reminder rows.

DO $mig$
DECLARE
  def text;
  new_def text;
  anchor_old text := 'WHEN ''join_request'' THEN notification_url := ''/notifications'';';
  anchor_new text := $repl$WHEN 'subscription_renewal_reminder' THEN
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
    WHEN 'join_request' THEN notification_url := '/notifications';$repl$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'compute_push_notification_url';

  IF def IS NULL THEN
    RAISE EXCEPTION 'compute_push_notification_url not found';
  END IF;

  IF position(anchor_old in def) = 0 THEN
    RAISE EXCEPTION 'join_request branch anchor not found';
  END IF;

  new_def := replace(def, anchor_old, anchor_new);

  EXECUTE new_def;
END
$mig$;

-- Backfill existing rows so the bell filter and tap-switch work for reminders
-- that were already delivered.
UPDATE public.notifications n
SET club_id = t.club_id
FROM public.teams t
WHERE n.type = 'subscription_renewal_reminder'
  AND n.club_id IS NULL
  AND n.related_id = t.id;

UPDATE public.notifications n
SET club_id = c.id
FROM public.clubs c
WHERE n.type = 'subscription_renewal_reminder'
  AND n.club_id IS NULL
  AND n.related_id = c.id;