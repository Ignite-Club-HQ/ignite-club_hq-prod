-- Create saved_locations table
CREATE TABLE public.saved_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  address TEXT NOT NULL,
  name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.saved_locations ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their own saved locations" 
ON public.saved_locations 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create team_sponsor_allocations table
CREATE TABLE public.team_sponsor_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  sponsor_id UUID NOT NULL REFERENCES public.sponsors(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(team_id, sponsor_id)
);

-- Enable RLS
ALTER TABLE public.team_sponsor_allocations ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view team sponsor allocations" 
ON public.team_sponsor_allocations 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Team admins can manage allocations" 
ON public.team_sponsor_allocations 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM teams t
    WHERE t.id = team_sponsor_allocations.team_id
    AND (
      has_role(auth.uid(), 'club_admin'::app_role, t.club_id, NULL::uuid)
      OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, t.id)
    )
  )
);

-- Create player_of_match table for tracking nominations
CREATE TABLE public.player_of_match (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID,
  child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
  points_awarded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id)
);

-- Enable RLS
ALTER TABLE public.player_of_match ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Team members can view player of match" 
ON public.player_of_match 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = player_of_match.event_id
    AND (is_team_member(auth.uid(), e.team_id) OR is_club_member(auth.uid(), e.club_id))
  )
);

CREATE POLICY "Admins can manage player of match" 
ON public.player_of_match 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = player_of_match.event_id
    AND (
      has_role(auth.uid(), 'club_admin'::app_role, e.club_id, NULL::uuid)
      OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, e.team_id)
      OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, e.team_id)
    )
  )
);

-- Add notes column to member_subscription_payments
ALTER TABLE public.member_subscription_payments 
ADD COLUMN IF NOT EXISTS notes TEXT;