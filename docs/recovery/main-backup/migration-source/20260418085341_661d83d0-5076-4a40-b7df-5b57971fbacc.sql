-- Pinned messages table supporting team, club, and group chats
CREATE TABLE public.pinned_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_type TEXT NOT NULL CHECK (chat_type IN ('team', 'club', 'group')),
  chat_id UUID NOT NULL,
  message_id UUID NOT NULL,
  pinned_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_type, chat_id, message_id)
);

CREATE INDEX idx_pinned_messages_chat ON public.pinned_messages(chat_type, chat_id, created_at DESC);
CREATE INDEX idx_pinned_messages_message ON public.pinned_messages(message_id);

ALTER TABLE public.pinned_messages ENABLE ROW LEVEL SECURITY;

-- Enforce 3-pin maximum per chat
CREATE OR REPLACE FUNCTION public.enforce_pin_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pin_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pin_count
  FROM public.pinned_messages
  WHERE chat_type = NEW.chat_type AND chat_id = NEW.chat_id;

  IF pin_count >= 3 THEN
    RAISE EXCEPTION 'Pin limit reached: a chat can have at most 3 pinned messages. Unpin one first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER pinned_messages_enforce_limit
  BEFORE INSERT ON public.pinned_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pin_limit();

-- Helper: can the current user access this chat?
CREATE OR REPLACE FUNCTION public.can_access_chat(_chat_type TEXT, _chat_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN FALSE; END IF;

  IF _chat_type = 'team' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = uid AND team_id = _chat_id
    );
  ELSIF _chat_type = 'club' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = uid AND club_id = _chat_id
    );
  ELSIF _chat_type = 'group' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.group_members
      WHERE user_id = uid AND group_id = _chat_id
    ) OR EXISTS (
      SELECT 1 FROM public.chat_groups cg
      JOIN public.user_roles ur ON ur.user_id = uid
      WHERE cg.id = _chat_id
        AND (
          (cg.team_id IS NOT NULL AND ur.team_id = cg.team_id AND ur.role = ANY(cg.allowed_roles))
          OR (cg.club_id IS NOT NULL AND ur.club_id = cg.club_id AND ur.role = ANY(cg.allowed_roles))
        )
    );
  END IF;

  RETURN FALSE;
END;
$$;

-- RLS policies
CREATE POLICY "Members can view pins in their chats"
ON public.pinned_messages
FOR SELECT
TO authenticated
USING (public.can_access_chat(chat_type, chat_id));

CREATE POLICY "Members can pin messages in their chats"
ON public.pinned_messages
FOR INSERT
TO authenticated
WITH CHECK (
  pinned_by = auth.uid()
  AND public.can_access_chat(chat_type, chat_id)
);

CREATE POLICY "Members can unpin messages in their chats"
ON public.pinned_messages
FOR DELETE
TO authenticated
USING (public.can_access_chat(chat_type, chat_id));

-- Realtime
ALTER TABLE public.pinned_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pinned_messages;