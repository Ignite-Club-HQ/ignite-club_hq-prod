CREATE OR REPLACE FUNCTION public.get_inbox_latest_team_messages(_team_ids uuid[])
RETURNS TABLE (
  team_id uuid,
  message_id uuid,
  text text,
  created_at timestamptz,
  image_url text,
  author_id uuid,
  is_club_announcement boolean,
  club_announcement_name text,
  author_display_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.team_id,
    m.id AS message_id,
    m.text,
    m.created_at,
    m.image_url,
    m.author_id,
    m.is_club_announcement,
    m.club_announcement_name,
    p.display_name AS author_display_name
  FROM (
    SELECT DISTINCT ON (tm.team_id)
      tm.team_id, tm.id, tm.text, tm.created_at, tm.image_url,
      tm.author_id, tm.is_club_announcement, tm.club_announcement_name
    FROM public.team_messages tm
    WHERE tm.team_id = ANY(_team_ids)
      AND tm.deleted_at IS NULL
    ORDER BY tm.team_id, tm.created_at DESC
  ) m
  LEFT JOIN public.profiles p ON p.id = m.author_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_latest_team_messages(uuid[]) TO authenticated;