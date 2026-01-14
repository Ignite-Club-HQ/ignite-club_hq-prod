-- Add redeemed_at column to reward_redemptions
ALTER TABLE public.reward_redemptions 
ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMP WITH TIME ZONE;

-- Add club_id to team_folders (some code expects this)
ALTER TABLE public.team_folders 
ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;

-- Create team_subscriptions table (separate from club_subscriptions)
CREATE TABLE IF NOT EXISTS public.team_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE UNIQUE,
  is_pro BOOLEAN NOT NULL DEFAULT false,
  is_pro_football BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.team_subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Team members can view subscriptions" 
ON public.team_subscriptions 
FOR SELECT 
USING (is_team_member(auth.uid(), team_id));

CREATE POLICY "Team admins can manage subscriptions" 
ON public.team_subscriptions 
FOR ALL 
USING (
  has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id) OR
  has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);

-- Add points column to player_of_match
ALTER TABLE public.player_of_match 
ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;