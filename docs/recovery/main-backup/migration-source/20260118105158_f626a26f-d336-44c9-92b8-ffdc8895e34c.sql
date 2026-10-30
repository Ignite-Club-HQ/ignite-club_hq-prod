-- Create table to track hidden DM conversations per user
CREATE TABLE public.hidden_dm_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  hidden_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, conversation_id)
);

-- Enable RLS
ALTER TABLE public.hidden_dm_conversations ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own hidden conversations
CREATE POLICY "Users can view their own hidden conversations"
ON public.hidden_dm_conversations
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can hide conversations"
ON public.hidden_dm_conversations
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unhide conversations"
ON public.hidden_dm_conversations
FOR DELETE
USING (auth.uid() = user_id);

-- Create index for fast lookups
CREATE INDEX idx_hidden_dm_conversations_user_id ON public.hidden_dm_conversations(user_id);
CREATE INDEX idx_hidden_dm_conversations_conversation_id ON public.hidden_dm_conversations(conversation_id);