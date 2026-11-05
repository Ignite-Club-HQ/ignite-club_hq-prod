-- Fix infinite recursion: child_team_assignments policy references children table with RLS

-- Create a security definer function to check if user is parent of child
CREATE OR REPLACE FUNCTION public.is_parent_of_child(_user_id uuid, _child_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.children
    WHERE id = _child_id AND parent_id = _user_id
  )
$$;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Parents can view their children's assignments" ON public.child_team_assignments;

-- Recreate using security definer function
CREATE POLICY "Parents can view their children's assignments"
ON public.child_team_assignments
FOR SELECT
TO authenticated
USING (public.is_parent_of_child(auth.uid(), child_id));

-- Also fix the Guardians policy on children to use security definer to prevent future recursion
DROP POLICY IF EXISTS "Guardians can view linked children" ON public.children;

CREATE OR REPLACE FUNCTION public.is_guardian_of_child(_user_id uuid, _child_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.child_guardians
    WHERE child_id = _child_id AND guardian_id = _user_id
  )
$$;

CREATE POLICY "Guardians can view linked children"
ON public.children
FOR SELECT
TO authenticated
USING (public.is_guardian_of_child(auth.uid(), id));