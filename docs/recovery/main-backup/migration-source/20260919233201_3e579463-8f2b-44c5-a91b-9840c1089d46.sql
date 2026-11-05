CREATE OR REPLACE FUNCTION public.on_photo_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uploader_name text;
  team_name text;
  club_name text;
  notification_message text;
  member_user_id uuid;
  media_label text;
BEGIN
  IF NEW.show_in_feed IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  -- Pro gate: skip all notifications/emails unless the team or club is Pro.
  IF NOT public.is_team_or_club_pro(NEW.team_id, NEW.club_id) THEN
    RETURN NEW;
  END IF;

  media_label := CASE
    WHEN split_part(lower(COALESCE(NEW.file_url, NEW.image_url)), '?', 1)
      ~ '\.(mp4|mov|m4v|webm|avi|mkv)$'
    THEN 'video'
    ELSE 'photo'
  END;

  SELECT display_name INTO uploader_name FROM public.profiles WHERE id = NEW.uploader_id;

  IF NEW.team_id IS NOT NULL THEN
    SELECT name INTO team_name FROM public.teams WHERE id = NEW.team_id;
    notification_message := COALESCE(uploader_name, 'Someone') || ' uploaded a new ' || media_label || ' to ' || COALESCE(team_name, 'your team');

    FOR member_user_id IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.team_id = NEW.team_id
        AND ur.user_id != NEW.uploader_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'photo_uploaded', notification_message, NEW.id)
      ON CONFLICT DO NOTHING;

      PERFORM public.send_photo_notification_email(
        member_user_id, NEW.uploader_id, NEW.id, 'team', NEW.team_id, team_name
      );
    END LOOP;

  ELSIF NEW.club_id IS NOT NULL THEN
    SELECT name INTO club_name FROM public.clubs WHERE id = NEW.club_id;
    notification_message := COALESCE(uploader_name, 'Someone') || ' uploaded a new ' || media_label || ' to ' || COALESCE(club_name, 'your club');

    FOR member_user_id IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.club_id = NEW.club_id
        AND ur.user_id != NEW.uploader_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'photo_uploaded', notification_message, NEW.id)
      ON CONFLICT DO NOTHING;

      PERFORM public.send_photo_notification_email(
        member_user_id, NEW.uploader_id, NEW.id, 'club', NEW.club_id, club_name
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;