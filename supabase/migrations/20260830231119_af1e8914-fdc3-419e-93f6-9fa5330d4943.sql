CREATE TABLE public.club_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  image_url text,
  author_id uuid,
  target_team_ids uuid[],
  is_important boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_club_news_club_published ON public.club_news (club_id, published_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_news TO authenticated;
GRANT ALL ON public.club_news TO service_role;

ALTER TABLE public.club_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Club members can view audience news"
ON public.club_news FOR SELECT TO authenticated
USING (
  is_published
  AND published_at <= now()
  AND public.is_club_member(auth.uid(), club_id)
  AND (
    target_team_ids IS NULL
    OR cardinality(target_team_ids) = 0
    OR EXISTS (
      SELECT 1 FROM unnest(target_team_ids) t(team_id)
      WHERE public.is_team_member(auth.uid(), t.team_id)
    )
  )
);

CREATE POLICY "Club admins can view all club news"
ON public.club_news FOR SELECT TO authenticated
USING (public.is_club_admin_for(club_id));

CREATE POLICY "Club admins can insert club news"
ON public.club_news FOR INSERT TO authenticated
WITH CHECK (public.is_club_admin_for(club_id));

CREATE POLICY "Club admins can update club news"
ON public.club_news FOR UPDATE TO authenticated
USING (public.is_club_admin_for(club_id))
WITH CHECK (public.is_club_admin_for(club_id));

CREATE POLICY "Club admins can delete club news"
ON public.club_news FOR DELETE TO authenticated
USING (public.is_club_admin_for(club_id));

CREATE TRIGGER update_club_news_updated_at
BEFORE UPDATE ON public.club_news
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notify the post's audience through the existing notifications pipeline.
CREATE OR REPLACE FUNCTION public.notify_club_news(_news_id uuid, _send_push boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.club_news;
  inserted integer := 0;
BEGIN
  SELECT * INTO n FROM public.club_news WHERE id = _news_id;
  IF n.id IS NULL THEN
    RAISE EXCEPTION 'News post not found';
  END IF;
  IF NOT public.is_club_admin_for(n.club_id) THEN
    RAISE EXCEPTION 'Not authorised to notify for this club';
  END IF;

  WITH audience AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = n.club_id
      AND ur.user_id <> COALESCE(n.author_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        n.target_team_ids IS NULL
        OR cardinality(n.target_team_ids) = 0
        OR ur.team_id = ANY (n.target_team_ids)
      )
  ), ins AS (
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push, dedupe_key)
    SELECT a.user_id,
           'club_news',
           CASE WHEN n.is_important THEN 'Important club news: ' ELSE 'New club news: ' END || n.title,
           n.id,
           n.club_id,
           NOT _send_push,
           'club_news:' || n.id::text || ':' || a.user_id::text
    FROM audience a
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted FROM ins;

  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_club_news(uuid, boolean) TO authenticated;