-- Batch 1 (approved Paul Cranwell, 5 Nov 2026): competition fixture visibility. Structural only.
-- PROD structural candidate; local rehearsal only until exact target review.
-- No score copying/clearing, bucket writes, policy replacements or old link changes.
-- CREATE (not REPLACE) fails on unexpected existing target contracts.

CREATE FUNCTION public.can_view_competition_fixture_event(_match_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.competition_matches cm
   JOIN public.competitions c ON c.id=cm.competition_id
   WHERE cm.id=_match_id AND (
     EXISTS (SELECT 1 FROM public.competition_roles cr WHERE cr.competition_id=c.id
       AND cr.user_id=auth.uid() AND cr.role IN ('owner','admin'))
     OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.club_id=c.organizer_club_id
       AND ur.user_id=auth.uid() AND ur.role='league_admin')))
$$;
CREATE FUNCTION public.get_my_viewable_competition_match_ids()
RETURNS TABLE(match_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT cm.id FROM public.competition_matches cm
 WHERE public.can_view_competition_fixture_event(cm.id)
$$;
REVOKE ALL ON FUNCTION public.can_view_competition_fixture_event(uuid),public.get_my_viewable_competition_match_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_competition_fixture_event(uuid),public.get_my_viewable_competition_match_ids() TO authenticated,service_role;
CREATE POLICY competition_admins_read_fixture_events ON public.events AS PERMISSIVE FOR SELECT TO authenticated
 USING (competition_match_id IS NOT NULL AND public.can_view_competition_fixture_event(competition_match_id));
