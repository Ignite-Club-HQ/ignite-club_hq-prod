
-- Helper: is the user an association_admin of the given association club?
CREATE OR REPLACE FUNCTION public.is_association_admin(_user_id uuid, _association_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.club_id = _association_id
      AND ur.role = 'association_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'app_admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_association_admin(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_association_admin(uuid, uuid) TO authenticated;

-- Extend is_competition_admin: association admin of organizer club or its parent
CREATE OR REPLACE FUNCTION public.is_competition_admin(_user_id uuid, _competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id
      AND cr.user_id = _user_id
      AND cr.role IN ('owner','admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.competitions c
    JOIN public.clubs cl ON cl.id = c.organizer_club_id
    WHERE c.id = _competition_id
      AND (
        public.is_association_admin(_user_id, cl.id)
        OR (cl.parent_org_id IS NOT NULL AND public.is_association_admin(_user_id, cl.parent_org_id))
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'app_admin'
  );
$$;

-- Broadcast table
CREATE TABLE public.association_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  sent_by UUID NOT NULL,
  message TEXT NOT NULL,
  club_ids UUID[] NULL,
  team_ids UUID[] NOT NULL DEFAULT '{}',
  recipient_team_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_association_broadcasts_assoc ON public.association_broadcasts(association_id, created_at DESC);

ALTER TABLE public.association_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Association admins can insert broadcasts"
ON public.association_broadcasts
FOR INSERT TO authenticated
WITH CHECK (public.is_association_admin(auth.uid(), association_id));

CREATE POLICY "Association admins can view broadcasts"
ON public.association_broadcasts
FOR SELECT TO authenticated
USING (public.is_association_admin(auth.uid(), association_id));

CREATE POLICY "Recipient team members can view association broadcasts"
ON public.association_broadcasts
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.team_id = ANY (association_broadcasts.team_ids)
  )
);
