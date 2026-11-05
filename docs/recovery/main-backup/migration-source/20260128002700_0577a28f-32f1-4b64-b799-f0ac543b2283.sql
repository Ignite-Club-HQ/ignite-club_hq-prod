-- Add mini_league_player_id column to rsvps table for standalone mini-league players
ALTER TABLE public.rsvps 
ADD COLUMN mini_league_player_id UUID REFERENCES public.mini_league_players(id) ON DELETE CASCADE;

-- Make user_id nullable to allow RSVPs for mini-league players without linked parents
ALTER TABLE public.rsvps 
ALTER COLUMN user_id DROP NOT NULL;

-- Add check constraint to ensure at least one identifier is present
ALTER TABLE public.rsvps
ADD CONSTRAINT rsvps_has_identifier_check 
CHECK (user_id IS NOT NULL OR mini_league_player_id IS NOT NULL);

-- Create index for mini_league_player_id lookups
CREATE INDEX idx_rsvps_mini_league_player_id ON public.rsvps(mini_league_player_id) WHERE mini_league_player_id IS NOT NULL;

-- Update RLS policies to allow admins to manage RSVPs for mini-league players
CREATE POLICY "Admins can manage mini league player RSVPs"
ON public.rsvps
FOR ALL
USING (
  mini_league_player_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM mini_league_players mlp
    JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
    JOIN user_roles ur ON ur.club_id = ml.club_id
    WHERE mlp.id = mini_league_player_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'team_admin', 'coach')
  )
)
WITH CHECK (
  mini_league_player_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM mini_league_players mlp
    JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
    JOIN user_roles ur ON ur.club_id = ml.club_id
    WHERE mlp.id = mini_league_player_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'team_admin', 'coach')
  )
);