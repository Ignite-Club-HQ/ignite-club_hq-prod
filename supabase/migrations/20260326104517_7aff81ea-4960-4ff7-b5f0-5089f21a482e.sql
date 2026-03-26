-- Allow guardians to view children they are linked to via child_guardians
CREATE POLICY "Guardians can view linked children"
ON public.children
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.child_guardians cg
    WHERE cg.child_id = children.id
    AND cg.guardian_id = auth.uid()
  )
);