CREATE OR REPLACE FUNCTION public.tg_team_messages_update_parent_preview()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _author_name text;
  _latest RECORD;
  _team_id uuid;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT display_name INTO _author_name FROM public.profiles WHERE id = NEW.author_id;
    UPDATE public.teams SET
      last_message_id = NEW.id,
      last_message_text = NEW.text,
      last_message_at = NEW.created_at,
      last_message_author_id = NEW.author_id,
      last_message_author_name = _author_name,
      last_message_image_url = NEW.image_url,
      last_message_is_system = COALESCE(NEW.is_system_message, false),
      last_message_is_club_announcement = COALESCE(NEW.is_club_announcement, false),
      last_message_club_announcement_name = NEW.club_announcement_name
    WHERE id = NEW.team_id
      AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
    RETURN NEW;
  END IF;

  IF (TG_OP = 'UPDATE'
      AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
      AND OLD.text IS NOT DISTINCT FROM NEW.text
      AND OLD.image_url IS NOT DISTINCT FROM NEW.image_url) THEN
    RETURN NEW;
  END IF;

  _team_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END;

  SELECT tm.id, tm.text, tm.created_at, tm.image_url, tm.author_id,
         tm.is_system_message, tm.is_club_announcement, tm.club_announcement_name,
         p.display_name AS author_name
    INTO _latest
  FROM public.team_messages tm
  LEFT JOIN public.profiles p ON p.id = tm.author_id
  WHERE tm.team_id = _team_id AND tm.deleted_at IS NULL
  ORDER BY tm.created_at DESC
  LIMIT 1;

  UPDATE public.teams SET
    last_message_id = _latest.id,
    last_message_text = _latest.text,
    last_message_at = _latest.created_at,
    last_message_author_id = _latest.author_id,
    last_message_author_name = _latest.author_name,
    last_message_image_url = _latest.image_url,
    last_message_is_system = COALESCE(_latest.is_system_message, false),
    last_message_is_club_announcement = COALESCE(_latest.is_club_announcement, false),
    last_message_club_announcement_name = _latest.club_announcement_name
  WHERE id = _team_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_club_messages_update_parent_preview()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _author_name text;
  _latest RECORD;
  _club_id uuid;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT display_name INTO _author_name FROM public.profiles WHERE id = NEW.author_id;
    UPDATE public.clubs SET
      last_message_id = NEW.id,
      last_message_text = NEW.text,
      last_message_at = NEW.created_at,
      last_message_author_id = NEW.author_id,
      last_message_author_name = _author_name,
      last_message_image_url = NEW.image_url
    WHERE id = NEW.club_id
      AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
    RETURN NEW;
  END IF;

  IF (TG_OP = 'UPDATE'
      AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
      AND OLD.text IS NOT DISTINCT FROM NEW.text
      AND OLD.image_url IS NOT DISTINCT FROM NEW.image_url) THEN
    RETURN NEW;
  END IF;

  _club_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.club_id ELSE NEW.club_id END;

  SELECT cm.id, cm.text, cm.created_at, cm.image_url, cm.author_id,
         p.display_name AS author_name
    INTO _latest
  FROM public.club_messages cm
  LEFT JOIN public.profiles p ON p.id = cm.author_id
  WHERE cm.club_id = _club_id AND cm.deleted_at IS NULL
  ORDER BY cm.created_at DESC
  LIMIT 1;

  UPDATE public.clubs SET
    last_message_id = _latest.id,
    last_message_text = _latest.text,
    last_message_at = _latest.created_at,
    last_message_author_id = _latest.author_id,
    last_message_author_name = _latest.author_name,
    last_message_image_url = _latest.image_url
  WHERE id = _club_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_group_messages_update_parent_preview()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _author_name text;
  _latest RECORD;
  _group_id uuid;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT display_name INTO _author_name FROM public.profiles WHERE id = NEW.author_id;
    UPDATE public.chat_groups SET
      last_message_id = NEW.id,
      last_message_text = NEW.text,
      last_message_at = NEW.created_at,
      last_message_author_id = NEW.author_id,
      last_message_author_name = _author_name,
      last_message_image_url = NEW.image_url,
      last_message_is_system = COALESCE(NEW.is_system_message, false)
    WHERE id = NEW.group_id
      AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
    RETURN NEW;
  END IF;

  IF (TG_OP = 'UPDATE'
      AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
      AND OLD.text IS NOT DISTINCT FROM NEW.text
      AND OLD.image_url IS NOT DISTINCT FROM NEW.image_url) THEN
    RETURN NEW;
  END IF;

  _group_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.group_id ELSE NEW.group_id END;

  SELECT gm.id, gm.text, gm.created_at, gm.image_url, gm.author_id,
         gm.is_system_message, p.display_name AS author_name
    INTO _latest
  FROM public.group_messages gm
  LEFT JOIN public.profiles p ON p.id = gm.author_id
  WHERE gm.group_id = _group_id AND gm.deleted_at IS NULL
  ORDER BY gm.created_at DESC
  LIMIT 1;

  UPDATE public.chat_groups SET
    last_message_id = _latest.id,
    last_message_text = _latest.text,
    last_message_at = _latest.created_at,
    last_message_author_id = _latest.author_id,
    last_message_author_name = _latest.author_name,
    last_message_image_url = _latest.image_url,
    last_message_is_system = COALESCE(_latest.is_system_message, false)
  WHERE id = _group_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS team_messages_update_parent_preview ON public.team_messages;
CREATE TRIGGER team_messages_update_parent_preview
AFTER INSERT OR UPDATE OF deleted_at, text, image_url ON public.team_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_team_messages_update_parent_preview();

DROP TRIGGER IF EXISTS club_messages_update_parent_preview ON public.club_messages;
CREATE TRIGGER club_messages_update_parent_preview
AFTER INSERT OR UPDATE OF deleted_at, text, image_url ON public.club_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_club_messages_update_parent_preview();

DROP TRIGGER IF EXISTS group_messages_update_parent_preview ON public.group_messages;
CREATE TRIGGER group_messages_update_parent_preview
AFTER INSERT OR UPDATE OF deleted_at, text, image_url ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_group_messages_update_parent_preview();