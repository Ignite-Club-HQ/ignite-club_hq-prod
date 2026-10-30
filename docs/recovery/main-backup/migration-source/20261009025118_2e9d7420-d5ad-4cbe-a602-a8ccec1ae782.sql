CREATE OR REPLACE FUNCTION public.can_view_competition_match_event(_user_id uuid, _match_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competition_matches m
    WHERE m.id = _match_id
      AND public.is_league_admin_for_competition(_user_id, m.competition_id)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_view_competition_match_event(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_competition_match_event(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "League admins can view competition fixture events" ON public.events;
CREATE POLICY "League admins can view competition fixture events"
ON public.events FOR SELECT TO authenticated
USING (
  team_id IS NOT NULL AND (
    (competition_id IS NOT NULL AND public.is_league_admin_for_competition((SELECT auth.uid()), competition_id))
    OR (competition_match_id IS NOT NULL AND public.can_view_competition_match_event((SELECT auth.uid()), competition_match_id))
  )
);