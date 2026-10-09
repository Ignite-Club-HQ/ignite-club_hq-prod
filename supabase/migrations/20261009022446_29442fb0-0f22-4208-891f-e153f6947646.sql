CREATE OR REPLACE FUNCTION public.is_league_admin_for_competition(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competitions c
    JOIN public.user_roles ur ON ur.club_id = c.organizer_club_id
    WHERE c.id = _competition_id AND ur.user_id = _user_id AND ur.role = 'league_admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_league_admin_for_competition(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_league_admin_for_competition(uuid, uuid) TO authenticated;

CREATE POLICY "League admins can view competition fixture events"
ON public.events FOR SELECT TO authenticated
USING (team_id IS NOT NULL AND competition_id IS NOT NULL
  AND public.is_league_admin_for_competition((SELECT auth.uid()), competition_id));