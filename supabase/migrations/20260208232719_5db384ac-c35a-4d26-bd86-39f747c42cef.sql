-- Add missing push notification preference columns to match email preferences
ALTER TABLE public.notification_preferences
ADD COLUMN IF NOT EXISTS admin_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS rewards_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS pom_enabled boolean DEFAULT true;