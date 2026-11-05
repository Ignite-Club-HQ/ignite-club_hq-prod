-- Add setting to club_subscriptions to control team-level reward overrides
ALTER TABLE public.club_subscriptions 
ADD COLUMN disable_team_pom_rewards boolean NOT NULL DEFAULT false;

-- Add comment explaining the setting
COMMENT ON COLUMN public.club_subscriptions.disable_team_pom_rewards IS 'When true, team admins cannot create team-specific Player of Match rewards - only club defaults apply.';