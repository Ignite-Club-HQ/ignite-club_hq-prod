-- Create child_guardians junction table for multiple guardians per child
CREATE TABLE public.child_guardians (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  guardian_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship_type TEXT DEFAULT 'guardian',
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(child_id, guardian_id)
);

-- Enable RLS
ALTER TABLE public.child_guardians ENABLE ROW LEVEL SECURITY;

-- Guardians can view their own child relationships
CREATE POLICY "Guardians can view their child relationships"
ON public.child_guardians FOR SELECT
USING (guardian_id = auth.uid());

-- Primary parent (owner) can view all guardians for their children
CREATE POLICY "Primary parent can view child guardians"
ON public.child_guardians FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = child_id AND c.parent_id = auth.uid()
  )
);

-- Primary parent can add guardians to their children
CREATE POLICY "Primary parent can add guardians"
ON public.child_guardians FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = child_id AND c.parent_id = auth.uid()
  )
);

-- Primary parent can remove guardians from their children
CREATE POLICY "Primary parent can remove guardians"
ON public.child_guardians FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = child_id AND c.parent_id = auth.uid()
  )
);

-- Guardians can remove themselves
CREATE POLICY "Guardians can remove themselves"
ON public.child_guardians FOR DELETE
USING (guardian_id = auth.uid());

-- Team/club admins can view guardians for children in their teams
CREATE POLICY "Admins can view child guardians in their teams"
ON public.child_guardians FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.child_team_assignments cta
    JOIN public.user_roles ur ON ur.team_id = cta.team_id
    WHERE cta.child_id = child_guardians.child_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('team_admin', 'coach', 'club_admin', 'app_admin')
  )
);

-- Migrate existing parent relationships to child_guardians as primary
INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
SELECT id, parent_id, 'parent', true
FROM public.children
WHERE parent_id IS NOT NULL;

-- Create function to check if user is guardian of child
CREATE OR REPLACE FUNCTION public.is_child_guardian(_user_id uuid, _child_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = _child_id AND c.parent_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.child_guardians cg
    WHERE cg.child_id = _child_id AND cg.guardian_id = _user_id
  )
$$;