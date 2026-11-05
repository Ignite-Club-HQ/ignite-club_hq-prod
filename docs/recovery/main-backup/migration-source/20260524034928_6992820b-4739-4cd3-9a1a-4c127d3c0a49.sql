DROP POLICY IF EXISTS "Members can view photos" ON public.photos;

CREATE POLICY "Members can view photos"
ON public.photos
FOR SELECT
USING (
  -- Team-scoped photos: only team members (or club/app admins)
  (
    team_id IS NOT NULL
    AND (
      public.is_team_member(auth.uid(), team_id)
      OR public.has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid)
      OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
  OR
  -- Club-level photos (no team): any club member
  (
    team_id IS NULL
    AND (
      public.is_club_member(auth.uid(), club_id)
      OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
);