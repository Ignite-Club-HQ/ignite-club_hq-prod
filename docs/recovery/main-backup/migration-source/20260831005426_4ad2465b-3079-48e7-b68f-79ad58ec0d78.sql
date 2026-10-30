CREATE OR REPLACE FUNCTION public.on_team_message_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  IF NEW.is_system_message THEN RETURN NEW; END IF;
  IF NEW.is_sponsor THEN RETURN NEW; END IF;

  -- Skip push fan-out for club-bot auto-posts (news/events already send their
  -- own notification when their push toggle is enabled).
  IF NEW.author_id = (SELECT c.bot_user_id FROM public.teams t JOIN public.clubs c ON c.id = t.club_id WHERE t.id = NEW.team_id) THEN
    PERFORM public.record_notification_dispatch(NULL, 'team', NEW.id, 'skipped: club bot auto-post');
    RETURN NEW;
  END IF;

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
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE request_id bigint; v_url text; v_key text;
BEGIN
  -- Skip push fan-out for club-bot auto-posts (news/events already send their
  -- own notification when their push toggle is enabled).
  IF NEW.author_id = (SELECT bot_user_id FROM public.clubs WHERE id = NEW.club_id) THEN
    PERFORM public.record_notification_dispatch(NULL, 'club', NEW.id, 'skipped: club bot auto-post');
    RETURN NEW;
  END IF;

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