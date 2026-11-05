-- REVIEW / LOCAL REHEARSAL ONLY. Keep officials' audience/read policies and validator.
-- Scope discovery to caller's requested club; retain production accepted-only entries.
CREATE OR REPLACE FUNCTION public.club_news_competition_ids(_club_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.id FROM public.competitions c
 WHERE c.organizer_club_id=_club_id AND auth.uid() IS NOT NULL
   AND public.is_club_member(auth.uid(),_club_id)
 UNION
 SELECT ce.competition_id FROM public.competition_entries ce JOIN public.teams t ON t.id=ce.team_id
 WHERE t.club_id=_club_id AND ce.status='accepted' AND auth.uid() IS NOT NULL
   AND public.is_club_member(auth.uid(),_club_id)
$$;
REVOKE ALL ON FUNCTION public.club_news_competition_ids(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.club_news_competition_ids(uuid) TO authenticated,service_role;