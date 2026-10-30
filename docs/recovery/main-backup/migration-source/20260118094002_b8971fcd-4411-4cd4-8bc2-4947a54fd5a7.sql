-- Create table for direct message conversations
CREATE TABLE public.direct_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_1 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_2 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Ensure each pair only has one conversation
  CONSTRAINT unique_participants UNIQUE (participant_1, participant_2),
  -- Ensure participant_1 < participant_2 to prevent duplicate pairs
  CONSTRAINT ordered_participants CHECK (participant_1 < participant_2)
);

-- Create table for direct messages
CREATE TABLE public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  image_url TEXT,
  reply_to_id UUID REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX idx_direct_conversations_participant_1 ON public.direct_conversations(participant_1);
CREATE INDEX idx_direct_conversations_participant_2 ON public.direct_conversations(participant_2);
CREATE INDEX idx_direct_messages_conversation ON public.direct_messages(conversation_id, created_at DESC);
CREATE INDEX idx_direct_messages_author ON public.direct_messages(author_id);

-- RLS Policies for direct_conversations
-- Users can see conversations they are part of
CREATE POLICY "Users can view their own conversations"
ON public.direct_conversations
FOR SELECT
USING (auth.uid() = participant_1 OR auth.uid() = participant_2);

-- Users can create conversations they are part of (as participant_1 since ordered)
CREATE POLICY "Users can create conversations they are part of"
ON public.direct_conversations
FOR INSERT
WITH CHECK (auth.uid() = participant_1 OR auth.uid() = participant_2);

-- RLS Policies for direct_messages
-- Users can see messages in conversations they are part of
CREATE POLICY "Users can view messages in their conversations"
ON public.direct_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.direct_conversations dc
    WHERE dc.id = conversation_id
    AND (auth.uid() = dc.participant_1 OR auth.uid() = dc.participant_2)
  )
);

-- Users can send messages in conversations they are part of
CREATE POLICY "Users can send messages in their conversations"
ON public.direct_messages
FOR INSERT
WITH CHECK (
  auth.uid() = author_id AND
  EXISTS (
    SELECT 1 FROM public.direct_conversations dc
    WHERE dc.id = conversation_id
    AND (auth.uid() = dc.participant_1 OR auth.uid() = dc.participant_2)
  )
);

-- Users can update their own messages
CREATE POLICY "Users can update their own messages"
ON public.direct_messages
FOR UPDATE
USING (auth.uid() = author_id);

-- Users can delete their own messages
CREATE POLICY "Users can delete their own messages"
ON public.direct_messages
FOR DELETE
USING (auth.uid() = author_id);

-- Create message_reactions support for DMs
ALTER TABLE public.message_reactions 
ADD COLUMN IF NOT EXISTS direct_message_id UUID REFERENCES public.direct_messages(id) ON DELETE CASCADE;

-- Create message_reads support for DMs
ALTER TABLE public.message_reads
ADD COLUMN IF NOT EXISTS direct_message_id UUID REFERENCES public.direct_messages(id) ON DELETE CASCADE;

-- Function to get or create a conversation between two users
CREATE OR REPLACE FUNCTION public.get_or_create_dm_conversation(other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id UUID;
  p1 UUID;
  p2 UUID;
BEGIN
  -- Order the participants
  IF auth.uid() < other_user_id THEN
    p1 := auth.uid();
    p2 := other_user_id;
  ELSE
    p1 := other_user_id;
    p2 := auth.uid();
  END IF;
  
  -- Check if conversation already exists
  SELECT id INTO conv_id
  FROM direct_conversations
  WHERE participant_1 = p1 AND participant_2 = p2;
  
  -- Create if doesn't exist
  IF conv_id IS NULL THEN
    INSERT INTO direct_conversations (participant_1, participant_2)
    VALUES (p1, p2)
    RETURNING id INTO conv_id;
  END IF;
  
  RETURN conv_id;
END;
$$;

-- Function to check if two users share a Pro club membership
CREATE OR REPLACE FUNCTION public.can_dm_user(other_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  shared_pro_club_exists BOOLEAN;
BEGIN
  -- Can't DM yourself
  IF current_user_id = other_user_id THEN
    RETURN FALSE;
  END IF;
  
  -- Check if both users are members of at least one common Pro club
  SELECT EXISTS (
    SELECT 1 
    FROM user_roles ur1
    JOIN user_roles ur2 ON ur1.club_id = ur2.club_id
    JOIN club_subscriptions cs ON cs.club_id = ur1.club_id
    WHERE ur1.user_id = current_user_id
      AND ur2.user_id = other_user_id
      AND ur1.club_id IS NOT NULL
      AND (cs.is_pro = true OR cs.is_pro_football = true OR cs.admin_pro_override = true OR cs.admin_pro_football_override = true)
      AND (cs.expires_at IS NULL OR cs.expires_at > now())
  ) INTO shared_pro_club_exists;
  
  RETURN shared_pro_club_exists;
END;
$$;

-- Update updated_at on conversation when new message is sent
CREATE OR REPLACE FUNCTION public.update_dm_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.direct_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_dm_conversation_on_message
AFTER INSERT ON public.direct_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_dm_conversation_timestamp();