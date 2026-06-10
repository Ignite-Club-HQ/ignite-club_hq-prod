-- League admins can view children assigned to their mini leagues
DROP POLICY IF EXISTS "League admins can view children in their leagues" ON public.children;
CREATE POLICY "League admins can view children in their leagues"
ON public.children
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.child_mini_league_assignments a
    WHERE a.child_id = children.id
      AND public.is_league_admin((SELECT auth.uid()), a.mini_league_id)
  )
);

-- Remove temporary diagnostic trigger
DROP TRIGGER IF EXISTS debug_log_child_insert_trigger ON public.children;
DROP FUNCTION IF EXISTS public.debug_log_child_insert();