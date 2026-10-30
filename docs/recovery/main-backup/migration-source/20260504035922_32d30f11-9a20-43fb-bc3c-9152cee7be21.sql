
-- =========================================================================
-- 1. Vault placeholder for service-role key (populate value out of band)
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    PERFORM vault.create_secret('REPLACE_WITH_SERVICE_ROLE_KEY', 'service_role_key',
      'Project service-role key. Internal edge function calls (notifications) authenticate with this. Update via SQL Editor: SELECT vault.update_secret(id, ''<key>'') FROM vault.secrets WHERE name = ''service_role_key''.');
  END IF;
END $$;

-- Helper to read it cleanly
CREATE OR REPLACE FUNCTION public._internal_service_role_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._internal_service_role_key() FROM PUBLIC, anon, authenticated;

-- =========================================================================
-- 2. business_profiles.contact_email exposure
-- =========================================================================
DROP POLICY IF EXISTS "Authenticated users can view visible sponsor profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Sponsors can view own profile" ON public.business_profiles;

-- Owners see their own row (any column)
CREATE POLICY "Sponsors can view own profile"
ON public.business_profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Other authenticated users can view visible profiles, but contact_email
-- is hidden via a column-level grant restriction below.
CREATE POLICY "Authenticated users can view visible sponsor profiles"
ON public.business_profiles
FOR SELECT
TO authenticated
USING (is_visible = true);

-- Restrict the contact_email column from non-owners. Revoke direct column SELECT
-- and expose via a SECURITY DEFINER function.
REVOKE SELECT (contact_email) ON public.business_profiles FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_business_contact_email(_business_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bp.contact_email
  FROM public.business_profiles bp
  WHERE bp.id = _business_id
    AND (
      bp.user_id = auth.uid()
      OR public.has_role(auth.uid(), 'app_admin'::app_role)
      OR public.has_role(auth.uid(), 'club_admin'::app_role)
    )
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.get_business_contact_email(uuid) TO authenticated;

-- =========================================================================
-- 3. eoi_submissions.claim_token exposure
-- =========================================================================
-- Revoke claim_token from all non-service roles. Frontend uses RPCs.
REVOKE SELECT (claim_token) ON public.eoi_submissions FROM anon, authenticated;

-- Frontend "claim by token" (replaces direct UPDATE that needed claim_token visibility)
CREATE OR REPLACE FUNCTION public.claim_eoi_by_token(_token text)
RETURNS public.eoi_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.eoi_submissions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.eoi_submissions
     SET claimed_at = now(),
         parent_user_id = COALESCE(parent_user_id, auth.uid())
   WHERE claim_token = _token
     AND (
       parent_user_id = auth.uid()
       OR lower(parent_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
       OR parent_user_id IS NULL
     )
   RETURNING * INTO v_row;

  RETURN v_row;
END
$$;
GRANT EXECUTE ON FUNCTION public.claim_eoi_by_token(text) TO authenticated;

-- =========================================================================
-- 4. vault_drive_links.refresh_token exposure
-- =========================================================================
-- Refresh tokens must never be read by client roles. The resolve-drive-titles
-- edge function uses the service role and is unaffected.
REVOKE SELECT (refresh_token) ON public.vault_drive_links FROM anon, authenticated;

-- =========================================================================
-- 5. Replace anon-key usage in notification email DB triggers/helpers
-- =========================================================================
CREATE OR REPLACE FUNCTION public.send_message_notification_email(
  p_recipient_user_id uuid, p_sender_user_id uuid, p_message_text text,
  p_message_type text, p_context_id uuid, p_context_name text,
  p_message_id uuid, p_has_image boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_key text := public._internal_service_role_key();
BEGIN
  IF v_key IS NULL OR v_key = '' OR v_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-message-notification-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'recipientUserId', p_recipient_user_id,
      'senderUserId', p_sender_user_id,
      'messageText', COALESCE(p_message_text,''),
      'messageType', p_message_type,
      'contextId', p_context_id,
      'contextName', COALESCE(p_context_name,''),
      'messageId', p_message_id,
      'hasImage', p_has_image));
END
$function$;

CREATE OR REPLACE FUNCTION public.send_photo_notification_email(
  p_recipient_user_id uuid, p_uploader_user_id uuid, p_photo_id uuid,
  p_context_type text, p_context_id uuid, p_context_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_key text := public._internal_service_role_key();
BEGIN
  IF v_key IS NULL OR v_key = '' OR v_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-photo-notification-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'recipientUserId', p_recipient_user_id,
      'uploaderUserId', p_uploader_user_id,
      'photoId', p_photo_id,
      'contextType', p_context_type,
      'contextId', p_context_id,
      'contextName', COALESCE(p_context_name,'')));
END
$function$;

CREATE OR REPLACE FUNCTION public.send_duty_notification_email(
  p_recipient_user_id uuid, p_duty_name text, p_event_id uuid, p_event_title text,
  p_event_date text, p_event_time text, p_team_name text, p_club_name text, p_club_logo_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_key text := public._internal_service_role_key();
BEGIN
  IF v_key IS NULL OR v_key = '' OR v_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-duty-notification-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'recipientUserId', p_recipient_user_id,
      'dutyName', p_duty_name,
      'eventId', p_event_id,
      'eventTitle', COALESCE(p_event_title,'Upcoming Event'),
      'eventDate', COALESCE(p_event_date,''),
      'eventTime', COALESCE(p_event_time,''),
      'teamName', COALESCE(p_team_name,''),
      'clubName', COALESCE(p_club_name,'Your Club'),
      'clubLogoUrl', COALESCE(p_club_logo_url,'')));
END
$function$;

CREATE OR REPLACE FUNCTION public.notify_enrolment_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  child_name text;
  class_name text;
  club_name text;
  term_name text;
  recipient_id uuid;
  enrolment_status text;
  v_key text := public._internal_service_role_key();
BEGIN
  IF v_key IS NULL OR v_key = '' OR v_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN
    RETURN NEW;
  END IF;

  SELECT t.name, c.name INTO class_name, club_name
  FROM teams t JOIN clubs c ON c.id = t.club_id WHERE t.id = NEW.team_id;
  SELECT name INTO term_name FROM terms WHERE id = NEW.term_id;

  IF NEW.child_id IS NOT NULL THEN
    SELECT c.name, c.parent_id INTO child_name, recipient_id
    FROM children c WHERE c.id = NEW.child_id;
  ELSE
    recipient_id := NEW.user_id;
  END IF;

  IF recipient_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'waitlisted' AND NEW.status = 'enrolled' THEN
    enrolment_status := 'promoted';
  ELSE
    enrolment_status := NEW.status;
  END IF;

  IF enrolment_status NOT IN ('enrolled','waitlisted','promoted') THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-enrolment-notification-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'recipientUserId', recipient_id,
      'childName', child_name,
      'className', COALESCE(class_name,'Class'),
      'clubName', COALESCE(club_name,'Organisation'),
      'status', enrolment_status,
      'termName', term_name));

  RETURN NEW;
END
$function$;

-- =========================================================================
-- 6. RPC wrappers so the frontend can trigger reward/pitch/game-stats
-- emails without holding the service-role key.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.send_reward_redeemed_email_rpc(
  _reward_name text,
  _points_spent integer,
  _remaining_points integer,
  _club_name text,
  _reward_description text DEFAULT NULL,
  _sponsor_name text DEFAULT NULL,
  _show_qr_code boolean DEFAULT false,
  _club_logo_url text DEFAULT NULL,
  _reward_logo_url text DEFAULT NULL,
  _redeemed_for_child_name text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := public._internal_service_role_key();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_key IS NULL OR v_key = '' OR v_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-reward-redeemed-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'recipientUserId', v_uid,
      'rewardName', _reward_name,
      'pointsSpent', _points_spent,
      'remainingPoints', _remaining_points,
      'clubName', _club_name,
      'rewardDescription', _reward_description,
      'sponsorName', _sponsor_name,
      'showQrCode', _show_qr_code,
      'clubLogoUrl', _club_logo_url,
      'rewardLogoUrl', _reward_logo_url,
      'redeemedForChildName', _redeemed_for_child_name));
END
$$;
GRANT EXECUTE ON FUNCTION public.send_reward_redeemed_email_rpc(
  text,integer,integer,text,text,text,boolean,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_pitch_board_notification_email_rpc(
  _recipient_user_id uuid,
  _team_id uuid,
  _team_name text,
  _notification_type text,
  _notification_message text,
  _event_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := public._internal_service_role_key();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Caller must be a member of the team (any role).
  IF _team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND team_id = _team_id
  ) AND NOT public.has_role(v_uid, 'app_admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF v_key IS NULL OR v_key = '' OR v_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-pitch-board-notification-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'recipientUserId', _recipient_user_id,
      'teamId', _team_id,
      'teamName', _team_name,
      'notificationType', _notification_type,
      'notificationMessage', _notification_message,
      'eventId', _event_id));
END
$$;
GRANT EXECUTE ON FUNCTION public.send_pitch_board_notification_email_rpc(
  uuid,uuid,text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_game_stats_email_rpc(
  _event_id uuid,
  _team_id uuid,
  _event_title text,
  _event_date text,
  _opponent text,
  _total_players integer,
  _total_game_time text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := public._internal_service_role_key();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = v_uid AND team_id = _team_id
       AND role IN ('coach','team_admin','team_subs_manager')
  ) AND NOT public.has_role(v_uid, 'app_admin'::app_role)
    AND NOT public.has_role(v_uid, 'club_admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF v_key IS NULL OR v_key = '' OR v_key = 'REPLACE_WITH_SERVICE_ROLE_KEY' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-game-stats-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'eventId', _event_id,
      'teamId', _team_id,
      'eventTitle', COALESCE(_event_title,'Game'),
      'eventDate', COALESCE(_event_date,''),
      'opponent', COALESCE(_opponent,''),
      'totalPlayers', _total_players,
      'totalGameTime', _total_game_time));
END
$$;
GRANT EXECUTE ON FUNCTION public.send_game_stats_email_rpc(
  uuid,uuid,text,text,text,integer,text) TO authenticated;
