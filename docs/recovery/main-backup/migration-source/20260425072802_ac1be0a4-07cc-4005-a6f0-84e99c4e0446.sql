-- Create table to track hidden custom group chats
CREATE TABLE IF NOT EXISTS public.hidden_chat_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_hidden_chat_groups_user ON public.hidden_chat_groups(user_id);

ALTER TABLE public.hidden_chat_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own hidden groups"
  ON public.hidden_chat_groups
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can hide groups for themselves"
  ON public.hidden_chat_groups
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unhide their own groups"
  ON public.hidden_chat_groups
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own hidden groups"
  ON public.hidden_chat_groups
  FOR UPDATE
  USING (auth.uid() = user_id);