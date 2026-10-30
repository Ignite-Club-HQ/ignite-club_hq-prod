
CREATE OR REPLACE FUNCTION public.on_team_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  IF NEW.is_system_message THEN RETURN NEW; END IF;
  IF NEW.is_sponsor THEN RETURN NEW; END IF;

  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM public.record_notification_dispatch(NULL, 'team', NEW.id, 'internal function credentials unavailable');
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
  PERFORM public.record_notification_dispatch(request_id, 'team', NEW.id, NULL);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.record_notification_dispatch(NULL, 'team', NEW.id, SQLERRM);
  RAISE WARNING 'Async notification dispatch failed for team message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_club_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM public.record_notification_dispatch(NULL, 'club', NEW.id, 'internal function credentials unavailable');
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
  PERFORM public.record_notification_dispatch(request_id, 'club', NEW.id, NULL);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.record_notification_dispatch(NULL, 'club', NEW.id, SQLERRM);
  RAISE WARNING 'Async notification dispatch failed for club message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_group_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  IF NEW.is_system_message THEN RETURN NEW; END IF;

  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM public.record_notification_dispatch(NULL, 'group', NEW.id, 'internal function credentials unavailable');
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
  PERFORM public.record_notification_dispatch(request_id, 'group', NEW.id, NULL);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.record_notification_dispatch(NULL, 'group', NEW.id, SQLERRM);
  RAISE WARNING 'Async notification dispatch failed for group message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_broadcast_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  v_url := public.internal_functions_base_url();
  v_key := public.internal_service_role_key();
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM public.record_notification_dispatch(NULL, 'broadcast', NEW.id, 'internal function credentials unavailable');
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
  PERFORM public.record_notification_dispatch(request_id, 'broadcast', NEW.id, NULL);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.record_notification_dispatch(NULL, 'broadcast', NEW.id, SQLERRM);
  RAISE WARNING 'Async notification dispatch failed for broadcast message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
