REVOKE ALL ON public.competition_admin_conversations FROM anon;
REVOKE ALL ON public.competition_admin_messages FROM anon;
ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_admin_messages;

CREATE OR REPLACE FUNCTION public.on_competition_admin_message_created()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE conv record; comp record; sender_name text; r uuid;
BEGIN
  SELECT * INTO conv FROM competition_admin_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN RETURN NEW; END IF;
  SELECT name, organizer_club_id INTO comp FROM competitions WHERE id = conv.competition_id;
  SELECT display_name INTO sender_name FROM profiles WHERE id = NEW.author_id;
  UPDATE competition_admin_conversations SET last_message_at = NEW.created_at, updated_at = now() WHERE id = conv.id;
  IF NEW.author_id = conv.member_user_id THEN
    FOR r IN SELECT DISTINCT user_id FROM competition_roles
      WHERE competition_id = conv.competition_id AND role IN ('owner','admin') AND user_id <> NEW.author_id
    LOOP
      INSERT INTO notifications (user_id, type, message, related_id, club_id)
      VALUES (r, 'competition_admin_message',
        COALESCE(sender_name,'A member') || ' messaged the ' || COALESCE(comp.name,'competition') || ' admins',
        conv.id, comp.organizer_club_id);
    END LOOP;
  ELSE
    -- Member may belong to a different club than the organiser; leave club unset so the reply isn't hidden.
    INSERT INTO notifications (user_id, type, message, related_id, club_id)
    VALUES (conv.member_user_id, 'competition_admin_message',
      COALESCE(comp.name,'Competition') || ' admins replied to your message', conv.id, NULL);
  END IF;
  RETURN NEW;
END $function$;