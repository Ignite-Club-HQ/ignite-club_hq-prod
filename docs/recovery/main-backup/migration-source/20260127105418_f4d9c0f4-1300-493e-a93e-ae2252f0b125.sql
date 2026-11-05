-- Add pitch state and timer state to mini league groups for individual pitch boards
ALTER TABLE public.mini_league_groups 
ADD COLUMN IF NOT EXISTS pitch_state jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS timer_state jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS linked_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

-- Create table for group-specific duties
CREATE TABLE IF NOT EXISTS public.mini_league_group_duties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.mini_league_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed')),
  points integer DEFAULT 0,
  points_awarded boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mini_league_group_duties ENABLE ROW LEVEL SECURITY;

-- RLS policies for group duties - league admins can manage
CREATE POLICY "League admins can manage group duties" ON public.mini_league_group_duties
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM mini_league_groups mlg
    JOIN mini_league_sessions mls ON mls.id = mlg.session_id
    JOIN mini_leagues ml ON ml.id = mls.mini_league_id
    JOIN user_roles ur ON ur.club_id = ml.club_id
    WHERE mlg.id = group_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'league_admin', 'app_admin')
  )
);

-- Parents in the league can view group duties
CREATE POLICY "League parents can view group duties" ON public.mini_league_group_duties
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM mini_league_groups mlg
    JOIN mini_league_sessions mls ON mls.id = mlg.session_id
    JOIN mini_league_players mlp ON mlp.mini_league_id = mls.mini_league_id
    WHERE mlg.id = group_id
    AND mlp.parent_user_id = auth.uid()
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_mini_league_group_duties_updated_at
BEFORE UPDATE ON public.mini_league_group_duties
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_mini_league_group_duties_group_id ON public.mini_league_group_duties(group_id);