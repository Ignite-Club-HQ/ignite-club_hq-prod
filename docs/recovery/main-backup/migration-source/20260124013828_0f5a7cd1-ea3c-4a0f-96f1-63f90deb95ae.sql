-- Add email notification preferences to existing notification_preferences table
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS email_messages_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_events_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_media_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_membership_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_admin_enabled boolean NOT NULL DEFAULT true;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id 
ON public.notification_preferences(user_id);

-- Add comment for documentation
COMMENT ON COLUMN public.notification_preferences.email_messages_enabled IS 'Whether user wants email notifications for messages';
COMMENT ON COLUMN public.notification_preferences.email_events_enabled IS 'Whether user wants email notifications for events and reminders';
COMMENT ON COLUMN public.notification_preferences.email_media_enabled IS 'Whether user wants email notifications for photos and media';
COMMENT ON COLUMN public.notification_preferences.email_membership_enabled IS 'Whether user wants email notifications for membership changes';
COMMENT ON COLUMN public.notification_preferences.email_admin_enabled IS 'Whether user wants email notifications for admin alerts like subscription expiry';