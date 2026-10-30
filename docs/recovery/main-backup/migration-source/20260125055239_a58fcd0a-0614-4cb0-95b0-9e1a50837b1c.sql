-- Add email_pitch_board_enabled column to notification_preferences
ALTER TABLE public.notification_preferences
ADD COLUMN IF NOT EXISTS email_pitch_board_enabled boolean NOT NULL DEFAULT true;