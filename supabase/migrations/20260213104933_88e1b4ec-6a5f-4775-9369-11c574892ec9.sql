
ALTER TABLE public.notification_preferences ALTER COLUMN email_messages_enabled SET DEFAULT false;
ALTER TABLE public.notification_preferences ALTER COLUMN email_media_enabled SET DEFAULT false;
ALTER TABLE public.notification_preferences ALTER COLUMN email_pitch_board_enabled SET DEFAULT false;
