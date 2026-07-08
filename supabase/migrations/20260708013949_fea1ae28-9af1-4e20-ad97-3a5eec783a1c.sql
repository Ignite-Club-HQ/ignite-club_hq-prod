-- Denormalise last-message preview onto teams, clubs, chat_groups.
-- club_messages has NO is_system_message column; team_messages and group_messages do.

-- 1) Columns
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS last_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_text text,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_author_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_author_name text,
  ADD COLUMN IF NOT EXISTS last_message_image_url text,
  ADD COLUMN IF NOT EXISTS last_message_is_system boolean,
  ADD COLUMN IF NOT EXISTS last_message_is_club_announcement boolean,
  ADD COLUMN IF NOT EXISTS last_message_club_announcement_name text;

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS last_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_text text,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_author_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_author_name text,
  ADD COLUMN IF NOT EXISTS last_message_image_url text;

ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS last_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_text text,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_author_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_author_name text,
  ADD COLUMN IF NOT EXISTS last_message_image_url text,
  ADD COLUMN IF NOT EXISTS last_message_is_system boolean;

-- 2) Trigger functions

CREATE OR REPLACE FUNCTION public.tg_team_messages_update_parent_preview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _author_name text;
  _latest RECORD;
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

  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
      SELECT tm.id, tm.text, tm.created_at, tm.image_url, tm.author_id,
             tm.is_system_message, tm.is_club_announcement, tm.club_announcement_name,
             p.display_name AS author_name
        INTO _latest
      FROM public.team_messages tm
      LEFT JOIN public.profiles p ON p.id = tm.author_id
      WHERE tm.team_id = NEW.team_id AND tm.deleted_at IS NULL
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
      WHERE id = NEW.team_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_club_messages_update_parent_preview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _author_name text;
  _latest RECORD;
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

  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
      SELECT cm.id, cm.text, cm.created_at, cm.image_url, cm.author_id,
             p.display_name AS author_name
        INTO _latest
      FROM public.club_messages cm
      LEFT JOIN public.profiles p ON p.id = cm.author_id
      WHERE cm.club_id = NEW.club_id AND cm.deleted_at IS NULL
      ORDER BY cm.created_at DESC
      LIMIT 1;

      UPDATE public.clubs SET
        last_message_id = _latest.id,
        last_message_text = _latest.text,
        last_message_at = _latest.created_at,
        last_message_author_id = _latest.author_id,
        last_message_author_name = _latest.author_name,
        last_message_image_url = _latest.image_url
      WHERE id = NEW.club_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_group_messages_update_parent_preview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _author_name text;
  _latest RECORD;
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

  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
      SELECT gm.id, gm.text, gm.created_at, gm.image_url, gm.author_id,
             gm.is_system_message, p.display_name AS author_name
        INTO _latest
      FROM public.group_messages gm
      LEFT JOIN public.profiles p ON p.id = gm.author_id
      WHERE gm.group_id = NEW.group_id AND gm.deleted_at IS NULL
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
      WHERE id = NEW.group_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Triggers
DROP TRIGGER IF EXISTS team_messages_update_parent_preview ON public.team_messages;
CREATE TRIGGER team_messages_update_parent_preview
AFTER INSERT OR UPDATE OF deleted_at ON public.team_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_team_messages_update_parent_preview();

DROP TRIGGER IF EXISTS club_messages_update_parent_preview ON public.club_messages;
CREATE TRIGGER club_messages_update_parent_preview
AFTER INSERT OR UPDATE OF deleted_at ON public.club_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_club_messages_update_parent_preview();

DROP TRIGGER IF EXISTS group_messages_update_parent_preview ON public.group_messages;
CREATE TRIGGER group_messages_update_parent_preview
AFTER INSERT OR UPDATE OF deleted_at ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_group_messages_update_parent_preview();

-- 4) Backfill
WITH latest AS (
  SELECT DISTINCT ON (tm.team_id)
    tm.team_id, tm.id, tm.text, tm.created_at, tm.image_url, tm.author_id,
    tm.is_system_message, tm.is_club_announcement, tm.club_announcement_name,
    p.display_name AS author_name
  FROM public.team_messages tm
  LEFT JOIN public.profiles p ON p.id = tm.author_id
  WHERE tm.deleted_at IS NULL
  ORDER BY tm.team_id, tm.created_at DESC
)
UPDATE public.teams t SET
  last_message_id = l.id,
  last_message_text = l.text,
  last_message_at = l.created_at,
  last_message_author_id = l.author_id,
  last_message_author_name = l.author_name,
  last_message_image_url = l.image_url,
  last_message_is_system = COALESCE(l.is_system_message, false),
  last_message_is_club_announcement = COALESCE(l.is_club_announcement, false),
  last_message_club_announcement_name = l.club_announcement_name
FROM latest l WHERE t.id = l.team_id;

WITH latest AS (
  SELECT DISTINCT ON (cm.club_id)
    cm.club_id, cm.id, cm.text, cm.created_at, cm.image_url, cm.author_id,
    p.display_name AS author_name
  FROM public.club_messages cm
  LEFT JOIN public.profiles p ON p.id = cm.author_id
  WHERE cm.deleted_at IS NULL
  ORDER BY cm.club_id, cm.created_at DESC
)
UPDATE public.clubs c SET
  last_message_id = l.id,
  last_message_text = l.text,
  last_message_at = l.created_at,
  last_message_author_id = l.author_id,
  last_message_author_name = l.author_name,
  last_message_image_url = l.image_url
FROM latest l WHERE c.id = l.club_id;

WITH latest AS (
  SELECT DISTINCT ON (gm.group_id)
    gm.group_id, gm.id, gm.text, gm.created_at, gm.image_url, gm.author_id,
    gm.is_system_message, p.display_name AS author_name
  FROM public.group_messages gm
  LEFT JOIN public.profiles p ON p.id = gm.author_id
  WHERE gm.deleted_at IS NULL
  ORDER BY gm.group_id, gm.created_at DESC
)
UPDATE public.chat_groups g SET
  last_message_id = l.id,
  last_message_text = l.text,
  last_message_at = l.created_at,
  last_message_author_id = l.author_id,
  last_message_author_name = l.author_name,
  last_message_image_url = l.image_url,
  last_message_is_system = COALESCE(l.is_system_message, false)
FROM latest l WHERE g.id = l.group_id;

-- 5) Rewrite inbox RPCs to read from denormalised columns
CREATE OR REPLACE FUNCTION public.get_inbox_latest_team_messages(_team_ids uuid[])
RETURNS TABLE (
  team_id uuid,
  message_id uuid,
  text text,
  created_at timestamptz,
  image_url text,
  author_id uuid,
  is_club_announcement boolean,
  club_announcement_name text,
  author_display_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.last_message_id,
    t.last_message_text,
    t.last_message_at,
    t.last_message_image_url,
    t.last_message_author_id,
    COALESCE(t.last_message_is_club_announcement, false),
    t.last_message_club_announcement_name,
    t.last_message_author_name
  FROM public.teams t
  WHERE t.id = ANY(_team_ids)
    AND t.last_message_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_inbox_latest_club_messages(_club_ids uuid[])
RETURNS TABLE (
  club_id uuid,
  message_id uuid,
  text text,
  created_at timestamptz,
  image_url text,
  author_id uuid,
  author_display_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.last_message_id,
    c.last_message_text,
    c.last_message_at,
    c.last_message_image_url,
    c.last_message_author_id,
    c.last_message_author_name
  FROM public.clubs c
  WHERE c.id = ANY(_club_ids)
    AND c.last_message_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_inbox_latest_group_messages(_group_ids uuid[])
RETURNS TABLE (
  group_id uuid,
  message_id uuid,
  text text,
  created_at timestamptz,
  image_url text,
  author_id uuid,
  author_display_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    g.id,
    g.last_message_id,
    g.last_message_text,
    g.last_message_at,
    g.last_message_image_url,
    g.last_message_author_id,
    g.last_message_author_name
  FROM public.chat_groups g
  WHERE g.id = ANY(_group_ids)
    AND g.last_message_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_latest_team_messages(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inbox_latest_club_messages(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inbox_latest_group_messages(uuid[]) TO authenticated;