-- Create child_mini_league_assignments table to link children to mini leagues
CREATE TABLE public.child_mini_league_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  mini_league_id UUID NOT NULL REFERENCES public.mini_leagues(id) ON DELETE CASCADE,
  ability_rating INTEGER NOT NULL DEFAULT 3 CHECK (ability_rating >= 1 AND ability_rating <= 5),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(child_id, mini_league_id)
);

-- Enable RLS
ALTER TABLE public.child_mini_league_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for child_mini_league_assignments
-- Parents can view their own children's assignments
CREATE POLICY "Parents can view their children's league assignments"
ON public.child_mini_league_assignments FOR SELECT
USING (
  public.is_child_guardian(auth.uid(), child_id)
);

-- League admins can view all assignments in their league
CREATE POLICY "League admins can view league assignments"
ON public.child_mini_league_assignments FOR SELECT
USING (
  public.is_league_admin(auth.uid(), mini_league_id)
);

-- League admins can insert assignments
CREATE POLICY "League admins can insert league assignments"
ON public.child_mini_league_assignments FOR INSERT
WITH CHECK (
  public.is_league_admin(auth.uid(), mini_league_id)
);

-- League admins can update assignments
CREATE POLICY "League admins can update league assignments"
ON public.child_mini_league_assignments FOR UPDATE
USING (
  public.is_league_admin(auth.uid(), mini_league_id)
);

-- League admins can delete assignments
CREATE POLICY "League admins can delete league assignments"
ON public.child_mini_league_assignments FOR DELETE
USING (
  public.is_league_admin(auth.uid(), mini_league_id)
);

-- Migrate existing mini_league_players to children + assignments
-- First, create children records for players that have a parent_user_id
INSERT INTO public.children (name, parent_id, ignite_points)
SELECT 
  mlp.name,
  mlp.parent_user_id,
  0
FROM public.mini_league_players mlp
WHERE mlp.parent_user_id IS NOT NULL
  AND NOT EXISTS (
    -- Don't create duplicate children with same name for same parent
    SELECT 1 FROM public.children c 
    WHERE c.parent_id = mlp.parent_user_id 
    AND lower(c.name) = lower(mlp.name)
  );

-- Create assignments for migrated children (those with parents)
INSERT INTO public.child_mini_league_assignments (child_id, mini_league_id, ability_rating, notes)
SELECT 
  c.id,
  mlp.mini_league_id,
  mlp.ability_rating,
  mlp.notes
FROM public.mini_league_players mlp
JOIN public.children c ON c.parent_id = mlp.parent_user_id AND lower(c.name) = lower(mlp.name)
WHERE mlp.parent_user_id IS NOT NULL
ON CONFLICT (child_id, mini_league_id) DO NOTHING;

-- Add child_id column to mini_league_players to support gradual migration
-- Players without parent_user_id stay as standalone players until linked
ALTER TABLE public.mini_league_players ADD COLUMN IF NOT EXISTS child_id UUID REFERENCES public.children(id) ON DELETE SET NULL;

-- Link existing mini_league_players to their corresponding children records
UPDATE public.mini_league_players mlp
SET child_id = c.id
FROM public.children c
WHERE mlp.parent_user_id = c.parent_id 
  AND lower(mlp.name) = lower(c.name)
  AND mlp.parent_user_id IS NOT NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_child_mini_league_assignments_child ON public.child_mini_league_assignments(child_id);
CREATE INDEX IF NOT EXISTS idx_child_mini_league_assignments_league ON public.child_mini_league_assignments(mini_league_id);
CREATE INDEX IF NOT EXISTS idx_mini_league_players_child ON public.mini_league_players(child_id);