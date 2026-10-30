
CREATE POLICY "Guardians can view assignments for linked children"
ON public.child_team_assignments
FOR SELECT
USING (public.is_guardian_of_child((SELECT auth.uid()), child_id));
