ALTER TABLE public.team_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.club_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.group_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.club_admin_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.broadcast_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_stamp_message_edited_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.text IS DISTINCT FROM OLD.text
     AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
     AND NEW.edited_at IS NOT DISTINCT FROM OLD.edited_at THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_team_messages_stamp_edited_at ON public.team_messages;
CREATE TRIGGER tg_team_messages_stamp_edited_at BEFORE UPDATE OF text ON public.team_messages FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_message_edited_at();

DROP TRIGGER IF EXISTS tg_club_messages_stamp_edited_at ON public.club_messages;
CREATE TRIGGER tg_club_messages_stamp_edited_at BEFORE UPDATE OF text ON public.club_messages FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_message_edited_at();

DROP TRIGGER IF EXISTS tg_group_messages_stamp_edited_at ON public.group_messages;
CREATE TRIGGER tg_group_messages_stamp_edited_at BEFORE UPDATE OF text ON public.group_messages FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_message_edited_at();

DROP TRIGGER IF EXISTS tg_direct_messages_stamp_edited_at ON public.direct_messages;
CREATE TRIGGER tg_direct_messages_stamp_edited_at BEFORE UPDATE OF text ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_message_edited_at();

DROP TRIGGER IF EXISTS tg_club_admin_messages_stamp_edited_at ON public.club_admin_messages;
CREATE TRIGGER tg_club_admin_messages_stamp_edited_at BEFORE UPDATE OF text ON public.club_admin_messages FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_message_edited_at();

DROP TRIGGER IF EXISTS tg_broadcast_messages_stamp_edited_at ON public.broadcast_messages;
CREATE TRIGGER tg_broadcast_messages_stamp_edited_at BEFORE UPDATE OF text ON public.broadcast_messages FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_message_edited_at();