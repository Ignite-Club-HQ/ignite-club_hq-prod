-- Add show_lineup_picker setting to team_subscriptions
ALTER TABLE public.team_subscriptions 
ADD COLUMN IF NOT EXISTS show_lineup_picker boolean NOT NULL DEFAULT false;