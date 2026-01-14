-- Create push notification logs table for debugging
CREATE TABLE IF NOT EXISTS public.push_notification_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id UUID,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'expired', 'invalid', 'skipped')),
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for querying by user
CREATE INDEX idx_push_logs_user_id ON public.push_notification_logs(user_id);
CREATE INDEX idx_push_logs_created_at ON public.push_notification_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.push_notification_logs ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own logs
CREATE POLICY "Users can view their own push logs"
ON public.push_notification_logs
FOR SELECT
USING (auth.uid() = user_id);

-- Allow service role to insert logs
CREATE POLICY "Service role can insert push logs"
ON public.push_notification_logs
FOR INSERT
WITH CHECK (true);