-- Add team_id column to club_rewards for team-specific overrides
ALTER TABLE public.club_rewards 
ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX idx_club_rewards_team_id ON public.club_rewards(team_id);

-- Add comment explaining the behavior
COMMENT ON COLUMN public.club_rewards.team_id IS 'Optional team-specific override. If NULL, reward applies to entire club (default). If set, this reward is specific to that team.';

-- Update RLS policies to allow team admins to manage team-specific rewards
CREATE POLICY "Team admins can manage team-specific rewards"
ON public.club_rewards
FOR ALL
TO authenticated
USING (
  team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.team_id = club_rewards.team_id
    AND ur.role IN ('team_admin', 'coach')
  )
)
WITH CHECK (
  team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.team_id = club_rewards.team_id
    AND ur.role IN ('team_admin', 'coach')
  )
);