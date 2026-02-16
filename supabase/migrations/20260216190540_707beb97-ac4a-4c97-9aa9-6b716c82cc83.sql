-- Revert all email notification defaults back to true
-- The auto-disable of messages and media will happen in code when push is enabled
ALTER TABLE public.notification_preferences ALTER COLUMN email_messages_enabled SET DEFAULT true;
ALTER TABLE public.notification_preferences ALTER COLUMN email_media_enabled SET DEFAULT true;