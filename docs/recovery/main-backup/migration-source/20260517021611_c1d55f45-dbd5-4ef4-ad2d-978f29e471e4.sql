
CREATE TABLE public.competition_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  sent_by UUID NOT NULL,
  message TEXT NOT NULL,
  division_ids UUID[] NULL,
  team_ids UUID[] NOT NULL DEFAULT '{}',
  recipient_team_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competition_broadcasts_competition ON public.competition_broadcasts(competition_id, created_at DESC);

ALTER TABLE public.competition_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Competition admins can insert broadcasts"
ON public.competition_broadcasts
FOR INSERT
TO authenticated
WITH CHECK (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "Competition admins can view broadcasts"
ON public.competition_broadcasts
FOR SELECT
TO authenticated
USING (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "Recipient team members can view broadcasts"
ON public.competition_broadcasts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.team_id = ANY (competition_broadcasts.team_ids)
  )
);
