CREATE OR REPLACE FUNCTION public.can_organise_competition(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'app_admin'
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND club_id = _club_id
      AND role IN ('club_admin', 'association_admin')
  );
$$;

DROP POLICY IF EXISTS "Create competitions" ON public.competitions;
CREATE POLICY "Create competitions"
ON public.competitions
FOR INSERT
WITH CHECK (
  created_by = auth.uid()
  AND public.can_organise_competition(auth.uid(), organizer_club_id)
);