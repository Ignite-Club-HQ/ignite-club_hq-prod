-- Allow guardians to manage RSVPs for children they are linked to
CREATE POLICY "Guardians can manage child RSVPs"
ON public.rsvps
FOR ALL
TO authenticated
USING (
  child_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM child_guardians cg
    WHERE cg.child_id = rsvps.child_id
    AND cg.guardian_id = auth.uid()
  )
)
WITH CHECK (
  child_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM child_guardians cg
    WHERE cg.child_id = rsvps.child_id
    AND cg.guardian_id = auth.uid()
  )
);