-- 1) Message notification triggers: authenticate with the service-role key from Vault.
CREATE OR REPLACE FUNCTION public.on_team_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  IF NEW.is_system_message THEN RETURN NEW; END IF;
  IF NEW.is_sponsor THEN RETURN NEW; END IF;

  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Notification dispatch skipped for team message %: internal function credentials unavailable', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/process-message-notifications',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'messageType','team','messageId',NEW.id,'authorId',NEW.author_id,
      'messageText',COALESCE(NEW.text,''),'imageUrl',NEW.image_url,
      'teamId',NEW.team_id,'replyToId',NEW.reply_to_id)
  ) INTO request_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for team message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_club_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Notification dispatch skipped for club message %: internal function credentials unavailable', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/process-message-notifications',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'messageType','club','messageId',NEW.id,'authorId',NEW.author_id,
      'messageText',COALESCE(NEW.text,''),'imageUrl',NEW.image_url,
      'clubId',NEW.club_id,'replyToId',NEW.reply_to_id)
  ) INTO request_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for club message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_group_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  IF NEW.is_system_message THEN RETURN NEW; END IF;

  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Notification dispatch skipped for group message %: internal function credentials unavailable', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/process-message-notifications',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'messageType','group','messageId',NEW.id,'authorId',NEW.author_id,
      'messageText',COALESCE(NEW.text,''),'imageUrl',NEW.image_url,
      'groupId',NEW.group_id,'replyToId',NEW.reply_to_id)
  ) INTO request_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for group message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_broadcast_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Notification dispatch skipped for broadcast message %: internal function credentials unavailable', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/process-message-notifications',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'messageType','broadcast','messageId',NEW.id,'authorId',NEW.author_id,
      'messageText',COALESCE(NEW.text,''),'imageUrl',NEW.image_url,
      'replyToId',NEW.reply_to_id)
  ) INTO request_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for broadcast message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 2) Block-alert trigger: authenticate the email dispatch with the service-role key.
CREATE OR REPLACE FUNCTION public.on_user_blocked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  blocker_name text; blocked_name text; blocker_email text; blocked_email text;
  v_url text; v_key text;
BEGIN
  SELECT display_name INTO blocker_name FROM public.profiles WHERE id = NEW.blocker_id;
  SELECT display_name INTO blocked_name FROM public.profiles WHERE id = NEW.blocked_id;
  SELECT email INTO blocker_email FROM auth.users WHERE id = NEW.blocker_id;
  SELECT email INTO blocked_email FROM auth.users WHERE id = NEW.blocked_id;

  INSERT INTO public.admin_alerts (alert_type, details)
  VALUES ('user_blocked', jsonb_build_object(
    'blocker_id', NEW.blocker_id,
    'blocker_name', COALESCE(blocker_name, 'Unknown'),
    'blocked_id', NEW.blocked_id,
    'blocked_name', COALESCE(blocked_name, 'Unknown'),
    'reason', NEW.reason
  ));

  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Block alert email skipped for block %: internal function credentials unavailable', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-block-alert-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'blockerName', COALESCE(blocker_name, 'Unknown'),
      'blockerEmail', COALESCE(blocker_email, 'no email'),
      'blockedName', COALESCE(blocked_name, 'Unknown'),
      'blockedEmail', COALESCE(blocked_email, 'no email'),
      'reason', NEW.reason
    )
  );
  RETURN NEW;
END;
$function$;

-- 3) Cron jobs: replace any hardcoded anon/JWT bearer token with the Vault service-role key.
DO $do$
DECLARE
  j record;
  new_cmd text;
BEGIN
  FOR j IN
    SELECT jobid, jobname, schedule, command
    FROM cron.job
    WHERE command ~ 'functions/v1/(backfill-chat-vault-groups|check-push-failure-rate|cleanup-old-notifications|cleanup-push-subscriptions|export-write-audit|post-game-photo-prompts|process-message-notifications|process-weekly-engagement-bonus|retry-missed-push-notifications|send-block-alert-email|send-feedback-email|send-invite-reminders|send-welcome-dm)'
      AND command ~ 'Bearer eyJ'
  LOOP
    new_cmd := regexp_replace(
      j.command,
      'Bearer eyJ[A-Za-z0-9_\-\.]+',
      'Bearer '' || public.internal_service_role_key() || ''',
      'g'
    );
    PERFORM cron.unschedule(j.jobname);
    PERFORM cron.schedule(j.jobname, j.schedule, new_cmd);
    RAISE NOTICE 'Rescheduled cron job % with service-role auth', j.jobname;
  END LOOP;
END
$do$;