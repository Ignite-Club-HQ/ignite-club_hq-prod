-- Add is_team_only column to sponsors
ALTER TABLE public.sponsors 
ADD COLUMN IF NOT EXISTS is_team_only BOOLEAN NOT NULL DEFAULT false;

-- Add status column to reward_redemptions
ALTER TABLE public.reward_redemptions 
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Add club_id column to reward_redemptions for easier querying
ALTER TABLE public.reward_redemptions 
ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;

-- Add storage_gb and uses_count to promo_codes
ALTER TABLE public.promo_codes 
ADD COLUMN IF NOT EXISTS storage_gb INTEGER,
ADD COLUMN IF NOT EXISTS uses_count INTEGER NOT NULL DEFAULT 0;

-- Create team_folders table
CREATE TABLE IF NOT EXISTS public.team_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.team_folders ENABLE ROW LEVEL SECURITY;

-- Create policies for team_folders
CREATE POLICY "Team members can view folders" 
ON public.team_folders 
FOR SELECT 
USING (is_team_member(auth.uid(), team_id));

CREATE POLICY "Team admins can manage folders" 
ON public.team_folders 
FOR ALL 
USING (
  has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id) OR
  has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
);

-- Add preferred_positions and jersey_number to team_player_positions
ALTER TABLE public.team_player_positions 
ADD COLUMN IF NOT EXISTS preferred_positions TEXT[],
ADD COLUMN IF NOT EXISTS jersey_number INTEGER;