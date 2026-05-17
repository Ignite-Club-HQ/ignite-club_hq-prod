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
    WHERE c.id = _competition_id
      AND public.can_organise_competition(_user_id, c.organizer_club_id)
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
  );
$$;