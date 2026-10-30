ALTER TABLE public.club_news
  ADD COLUMN IF NOT EXISTS target_mini_league_id uuid REFERENCES public.mini_leagues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS target_competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS club_news_target_competition_idx ON public.club_news(target_competition_id) WHERE target_competition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS club_news_target_mini_league_idx ON public.club_news(target_mini_league_id) WHERE target_mini_league_id IS NOT NULL;

-- Only one audience type per post; mini league / competition must match the post's club.
CREATE OR REPLACE FUNCTION public.validate_club_news_audience()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE kinds int;
BEGIN
  kinds := (CASE WHEN NEW.target_team_ids IS NOT NULL AND cardinality(NEW.target_team_ids) > 0 THEN 1 ELSE 0 END)
         + (CASE WHEN NEW.target_mini_league_id IS NOT NULL THEN 1 ELSE 0 END)
         + (CASE WHEN NEW.target_competition_id IS NOT NULL THEN 1 ELSE 0 END);
  IF kinds > 1 THEN
    RAISE EXCEPTION 'News can target teams, a mini league or a competition — not more than one';
  END IF;
  IF NEW.target_mini_league_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM mini_leagues WHERE id = NEW.target_mini_league_id AND club_id = NEW.club_id) THEN
    RAISE EXCEPTION 'Mini league does not belong to this club';
  END IF;
  IF NEW.target_competition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM competitions WHERE id = NEW.target_competition_id AND organizer_club_id = NEW.club_id) THEN
    RAISE EXCEPTION 'Competition news must belong to the organising club';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_club_news_audience ON public.club_news;
CREATE TRIGGER trg_validate_club_news_audience BEFORE INSERT OR UPDATE ON public.club_news
FOR EACH ROW EXECUTE FUNCTION public.validate_club_news_audience();

-- Who is in a competition's audience: entered-team members + officials/admins.
CREATE OR REPLACE FUNCTION public.is_competition_audience(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM competition_roles WHERE competition_id = _competition_id AND user_id = _user_id)
  OR EXISTS (SELECT 1 FROM competition_entries ce JOIN user_roles ur ON ur.team_id = ce.team_id
             WHERE ce.competition_id = _competition_id AND ce.status = 'accepted' AND ur.user_id = _user_id)
$$;
REVOKE EXECUTE ON FUNCTION public.is_competition_audience(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_competition_audience(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Club members can view audience news" ON public.club_news;
CREATE POLICY "Club members can view audience news" ON public.club_news FOR SELECT TO authenticated
USING (
  is_published AND published_at <= now() AND (
    (target_competition_id IS NULL AND target_mini_league_id IS NULL
      AND is_club_member(auth.uid(), club_id)
      AND (target_team_ids IS NULL OR cardinality(target_team_ids) = 0
           OR EXISTS (SELECT 1 FROM unnest(club_news.target_team_ids) t(team_id) WHERE is_team_member(auth.uid(), t.team_id))))
    OR (target_mini_league_id IS NOT NULL AND can_view_mini_league(auth.uid(), target_mini_league_id))
    OR (target_competition_id IS NOT NULL AND is_competition_audience(auth.uid(), target_competition_id))
  )
);

CREATE POLICY "Competition admins can view competition news" ON public.club_news FOR SELECT TO authenticated
USING (target_competition_id IS NOT NULL AND is_competition_role_admin(auth.uid(), target_competition_id));
CREATE POLICY "Competition admins can insert competition news" ON public.club_news FOR INSERT TO authenticated
WITH CHECK (target_competition_id IS NOT NULL AND is_competition_role_admin(auth.uid(), target_competition_id));
CREATE POLICY "Competition admins can update competition news" ON public.club_news FOR UPDATE TO authenticated
USING (target_competition_id IS NOT NULL AND is_competition_role_admin(auth.uid(), target_competition_id))
WITH CHECK (target_competition_id IS NOT NULL AND is_competition_role_admin(auth.uid(), target_competition_id));
CREATE POLICY "Competition admins can delete competition news" ON public.club_news FOR DELETE TO authenticated
USING (target_competition_id IS NOT NULL AND is_competition_role_admin(auth.uid(), target_competition_id));

-- Competition ids a club's teams are entered in (for showing competition news in that club's News).
CREATE OR REPLACE FUNCTION public.club_news_competition_ids(_club_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM competitions WHERE organizer_club_id = _club_id
  UNION
  SELECT ce.competition_id FROM competition_entries ce JOIN teams t ON t.id = ce.team_id
  WHERE t.club_id = _club_id AND ce.status = 'accepted'
$$;
REVOKE EXECUTE ON FUNCTION public.club_news_competition_ids(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.club_news_competition_ids(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_club_news(_news_id uuid, _send_push boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n public.club_news;
  inserted integer := 0;
  author uuid;
BEGIN
  SELECT * INTO n FROM public.club_news WHERE id = _news_id;
  IF n.id IS NULL THEN RAISE EXCEPTION 'News post not found'; END IF;
  IF NOT (public.is_club_admin_for(n.club_id)
          OR (n.target_competition_id IS NOT NULL AND public.is_competition_role_admin(auth.uid(), n.target_competition_id))) THEN
    RAISE EXCEPTION 'Not authorised to notify for this news';
  END IF;
  author := COALESCE(n.author_id, '00000000-0000-0000-0000-000000000000'::uuid);

  WITH audience AS (
    -- club / team news
    SELECT DISTINCT ur.user_id, n.club_id AS club_id
    FROM user_roles ur
    WHERE n.target_competition_id IS NULL AND n.target_mini_league_id IS NULL
      AND ur.club_id = n.club_id
      AND (n.target_team_ids IS NULL OR cardinality(n.target_team_ids) = 0 OR ur.team_id = ANY (n.target_team_ids))
    UNION
    -- mini league news
    SELECT DISTINCT u.user_id, n.club_id FROM (
      SELECT mlp.parent_user_id AS user_id FROM mini_league_players mlp WHERE mlp.mini_league_id = n.target_mini_league_id
      UNION SELECT mla.user_id FROM mini_league_admins mla WHERE mla.mini_league_id = n.target_mini_league_id
    ) u WHERE n.target_mini_league_id IS NOT NULL AND u.user_id IS NOT NULL
    UNION
    -- competition news: entered-team members in their own club, officials in organiser club
    SELECT DISTINCT ur.user_id, t.club_id
    FROM competition_entries ce JOIN teams t ON t.id = ce.team_id JOIN user_roles ur ON ur.team_id = ce.team_id
    WHERE n.target_competition_id IS NOT NULL AND ce.competition_id = n.target_competition_id AND ce.status = 'accepted'
    UNION
    SELECT DISTINCT cr.user_id, n.club_id FROM competition_roles cr
    WHERE n.target_competition_id IS NOT NULL AND cr.competition_id = n.target_competition_id
  ), ins AS (
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push, dedupe_key)
    SELECT DISTINCT ON (a.user_id) a.user_id, 'club_news',
      CASE WHEN n.is_important THEN 'Important news: ' ELSE 'New news: ' END || n.title,
      n.id, a.club_id, NOT _send_push,
      'club_news:' || n.id::text || ':' || a.user_id::text
    FROM audience a WHERE a.user_id <> author
    ORDER BY a.user_id
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted FROM ins;
  RETURN inserted;
END $$;