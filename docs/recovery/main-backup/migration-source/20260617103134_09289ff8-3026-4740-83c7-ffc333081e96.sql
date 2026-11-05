
CREATE OR REPLACE FUNCTION public.mark_read_on_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direct_message_id IS NOT NULL THEN
    INSERT INTO public.message_reads (user_id, direct_message_id, read_at)
    SELECT NEW.user_id, NEW.direct_message_id, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.message_reads
      WHERE user_id = NEW.user_id AND direct_message_id = NEW.direct_message_id
    );
  ELSIF NEW.team_message_id IS NOT NULL THEN
    INSERT INTO public.message_reads (user_id, team_message_id, read_at)
    SELECT NEW.user_id, NEW.team_message_id, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.message_reads
      WHERE user_id = NEW.user_id AND team_message_id = NEW.team_message_id
    );
  ELSIF NEW.club_message_id IS NOT NULL THEN
    INSERT INTO public.message_reads (user_id, club_message_id, read_at)
    SELECT NEW.user_id, NEW.club_message_id, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.message_reads
      WHERE user_id = NEW.user_id AND club_message_id = NEW.club_message_id
    );
  ELSIF NEW.group_message_id IS NOT NULL THEN
    INSERT INTO public.message_reads (user_id, group_message_id, read_at)
    SELECT NEW.user_id, NEW.group_message_id, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.message_reads
      WHERE user_id = NEW.user_id AND group_message_id = NEW.group_message_id
    );
  ELSIF NEW.broadcast_message_id IS NOT NULL THEN
    INSERT INTO public.message_reads (user_id, broadcast_message_id, read_at)
    SELECT NEW.user_id, NEW.broadcast_message_id, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.message_reads
      WHERE user_id = NEW.user_id AND broadcast_message_id = NEW.broadcast_message_id
    );
  ELSIF NEW.club_admin_message_id IS NOT NULL THEN
    INSERT INTO public.message_reads (user_id, club_admin_message_id, read_at)
    SELECT NEW.user_id, NEW.club_admin_message_id, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.message_reads
      WHERE user_id = NEW.user_id AND club_admin_message_id = NEW.club_admin_message_id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block reactions if read insert fails
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_read_on_reaction ON public.message_reactions;
CREATE TRIGGER trg_mark_read_on_reaction
AFTER INSERT ON public.message_reactions
FOR EACH ROW EXECUTE FUNCTION public.mark_read_on_reaction();
