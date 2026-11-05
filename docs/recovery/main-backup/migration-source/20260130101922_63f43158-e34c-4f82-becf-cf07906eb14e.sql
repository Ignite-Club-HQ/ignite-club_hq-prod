-- Create a table for system messages that appear like DMs but don't require a real user
CREATE TABLE public.system_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message_type text NOT NULL DEFAULT 'welcome',
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

-- Enable RLS
ALTER TABLE public.system_messages ENABLE ROW LEVEL SECURITY;

-- Users can only see their own system messages
CREATE POLICY "Users can view their own system messages"
  ON public.system_messages FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update read status on their own messages  
CREATE POLICY "Users can update their own system messages"
  ON public.system_messages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX idx_system_messages_user_id ON public.system_messages(user_id);
CREATE INDEX idx_system_messages_type ON public.system_messages(message_type);