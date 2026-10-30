-- REVIEW / LOCAL REHEARSAL ONLY. One unified notifier; both new APIs delegate.
-- Guard existing API too, so calling it directly cannot notify drafts/future posts.
-- The generated package supplies the fingerprint-bound deployed notify_club_news
-- body with only the publication check inserted (no second independent fanout).
CREATE FUNCTION public.notify_competition_news(_news_id uuid,_send_push boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.club_news;
BEGIN
 SELECT * INTO n FROM public.club_news WHERE id=_news_id;
 IF NOT FOUND OR n.target_competition_id IS NULL THEN RAISE EXCEPTION 'Competition news not found'; END IF;
 RETURN public.notify_club_news(_news_id,_send_push);
END; $$;
CREATE FUNCTION public.notify_mini_league_news(_news_id uuid,_send_push boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.club_news;
BEGIN
 SELECT * INTO n FROM public.club_news WHERE id=_news_id;
 IF NOT FOUND OR n.target_mini_league_id IS NULL THEN RAISE EXCEPTION 'Mini league news not found'; END IF;
 RETURN public.notify_club_news(_news_id,_send_push);
END; $$;
REVOKE ALL ON FUNCTION public.notify_competition_news(uuid,boolean),public.notify_mini_league_news(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.notify_competition_news(uuid,boolean),public.notify_mini_league_news(uuid,boolean) TO authenticated,service_role;