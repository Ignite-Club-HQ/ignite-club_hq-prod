-- Add sponsor_id to teams table
ALTER TABLE public.teams 
ADD COLUMN IF NOT EXISTS sponsor_id UUID REFERENCES public.sponsors(id) ON DELETE SET NULL;

-- Add admin_pro_override and admin_pro_football_override to team_subscriptions
ALTER TABLE public.team_subscriptions 
ADD COLUMN IF NOT EXISTS admin_pro_override BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS admin_pro_football_override BOOLEAN NOT NULL DEFAULT false;

-- Add address column to events (aliased from location)
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS address TEXT;

-- Update address from location where null
UPDATE public.events SET address = location WHERE address IS NULL;

-- Create pitch_formations table
CREATE TABLE IF NOT EXISTS public.pitch_formations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID,
  name TEXT NOT NULL,
  formation_data JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pitch_formations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their formations" 
ON public.pitch_formations 
FOR ALL 
USING (auth.uid() = user_id OR is_team_member(auth.uid(), team_id));

-- Add fill_in_player_name and other columns to game_player_stats
ALTER TABLE public.game_player_stats 
ADD COLUMN IF NOT EXISTS fill_in_player_name TEXT,
ADD COLUMN IF NOT EXISTS jersey_number INTEGER,
ADD COLUMN IF NOT EXISTS total_game_time INTEGER DEFAULT 0;

-- Add title and description to feedback (message will remain)
ALTER TABLE public.feedback 
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS description TEXT;