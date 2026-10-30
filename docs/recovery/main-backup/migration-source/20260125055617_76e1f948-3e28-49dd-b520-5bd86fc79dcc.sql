-- Add email preference columns for rewards and player of match notifications
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS email_rewards_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_pom_enabled boolean NOT NULL DEFAULT true;