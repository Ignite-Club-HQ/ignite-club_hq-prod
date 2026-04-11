-- Allow DM participants to view each other's profiles
CREATE POLICY "DM participants can view each other profiles"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.direct_conversations dc
    WHERE (
      (dc.participant_1 = auth.uid() AND dc.participant_2 = profiles.id)
      OR
      (dc.participant_2 = auth.uid() AND dc.participant_1 = profiles.id)
    )
  )
);