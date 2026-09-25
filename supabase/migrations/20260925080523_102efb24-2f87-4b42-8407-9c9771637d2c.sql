CREATE OR REPLACE FUNCTION public.is_competition_admin(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.competition_roles
    WHERE user_id = _user_id AND competition_id = _competition_id AND role IN ('owner','admin'))
$$;
GRANT EXECUTE ON FUNCTION public.is_competition_admin(uuid, uuid) TO authenticated;

CREATE TABLE public.competition_admin_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, member_user_id)
);
GRANT SELECT ON public.competition_admin_conversations TO authenticated;
GRANT ALL ON public.competition_admin_conversations TO service_role;
ALTER TABLE public.competition_admin_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Member or competition admins view conversation" ON public.competition_admin_conversations
FOR SELECT TO authenticated USING (
  member_user_id = auth.uid()
  OR public.is_competition_admin(auth.uid(), competition_id)
  OR public.has_role(auth.uid(), 'app_admin')
);

CREATE TABLE public.competition_admin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.competition_admin_conversations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  text text NOT NULL DEFAULT '',
  image_url text,
  is_admin_reply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.competition_admin_messages (conversation_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.competition_admin_messages TO authenticated;
GRANT ALL ON public.competition_admin_messages TO service_role;
ALTER TABLE public.competition_admin_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_competition_admin_conversation(_user_id uuid, _conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.competition_admin_conversations c
    WHERE c.id = _conversation_id AND (
      c.member_user_id = _user_id
      OR public.is_competition_admin(_user_id, c.competition_id)
      OR public.has_role(_user_id, 'app_admin')))
$$;
GRANT EXECUTE ON FUNCTION public.can_access_competition_admin_conversation(uuid, uuid) TO authenticated;

CREATE POLICY "Participants view messages" ON public.competition_admin_messages
FOR SELECT TO authenticated USING (public.can_access_competition_admin_conversation(auth.uid(), conversation_id));
CREATE POLICY "Participants send messages" ON public.competition_admin_messages
FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid() AND public.can_access_competition_admin_conversation(auth.uid(), conversation_id)
);
CREATE POLICY "Authors delete own messages" ON public.competition_admin_messages
FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_or_create_competition_admin_conversation(p_competition_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT id INTO v_id FROM competition_admin_conversations
   WHERE competition_id = p_competition_id AND member_user_id = v_uid;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF public.is_competition_admin(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'You are an admin of this competition';
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM competition_roles WHERE competition_id = p_competition_id
            AND user_id = v_uid AND role IN ('referee','committee','scorer'))
    OR EXISTS (SELECT 1 FROM competition_entries ce JOIN user_roles ur ON ur.team_id = ce.team_id
            WHERE ce.competition_id = p_competition_id AND ce.status IN ('invited','accepted')
              AND ur.user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'You are not part of this competition';
  END IF;
  INSERT INTO competition_admin_conversations (competition_id, member_user_id)
  VALUES (p_competition_id, v_uid) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.get_or_create_competition_admin_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_competition_admin_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.on_competition_admin_message_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE conv record; comp record; sender_name text; r uuid;
BEGIN
  SELECT * INTO conv FROM competition_admin_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN RETURN NEW; END IF;
  SELECT name, organizer_club_id INTO comp FROM competitions WHERE id = conv.competition_id;
  SELECT display_name INTO sender_name FROM profiles WHERE id = NEW.author_id;
  UPDATE competition_admin_conversations SET last_message_at = NEW.created_at, updated_at = now()
   WHERE id = conv.id;
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
    INSERT INTO notifications (user_id, type, message, related_id, club_id)
    VALUES (conv.member_user_id, 'competition_admin_message',
      COALESCE(comp.name,'Competition') || ' admins replied to your message', conv.id, comp.organizer_club_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_competition_admin_message_created AFTER INSERT ON public.competition_admin_messages
FOR EACH ROW EXECUTE FUNCTION public.on_competition_admin_message_created();

CREATE OR REPLACE FUNCTION public.stamp_competition_admin_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.is_admin_reply := NOT EXISTS (SELECT 1 FROM competition_admin_conversations
    WHERE id = NEW.conversation_id AND member_user_id = NEW.author_id);
  RETURN NEW;
END $$;
CREATE TRIGGER stamp_competition_admin_reply BEFORE INSERT ON public.competition_admin_messages
FOR EACH ROW EXECUTE FUNCTION public.stamp_competition_admin_reply();