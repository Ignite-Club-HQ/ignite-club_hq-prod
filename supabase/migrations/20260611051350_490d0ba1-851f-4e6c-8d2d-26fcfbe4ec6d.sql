CREATE POLICY "League admins can view mini league child guardians"
ON public.child_guardians
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.child_mini_league_assignments cmla
    WHERE cmla.child_id = child_guardians.child_id
      AND public.is_league_admin((SELECT auth.uid()), cmla.mini_league_id)
  )
);