CREATE OR REPLACE FUNCTION public.get_inbox_latest_club_messages(_club_ids uuid[])
RETURNS TABLE (
  club_id uuid,
  message_id uuid,
  text text,
  created_at timestamptz,
  image_url text,
  author_id uuid,
  author_display_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.club_id, m.id, m.text, m.created_at, m.image_url, m.author_id,
    p.display_name
  FROM (
    SELECT DISTINCT ON (cm.club_id)
      cm.club_id, cm.id, cm.text, cm.created_at, cm.image_url, cm.author_id
    FROM public.club_messages cm
    WHERE cm.club_id = ANY(_club_ids)
      AND cm.deleted_at IS NULL
    ORDER BY cm.club_id, cm.created_at DESC
  ) m
  LEFT JOIN public.profiles p ON p.id = m.author_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_latest_club_messages(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_inbox_latest_group_messages(_group_ids uuid[])
RETURNS TABLE (
  group_id uuid,
  message_id uuid,
  text text,
  created_at timestamptz,
  image_url text,
  author_id uuid,
  author_display_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.group_id, m.id, m.text, m.created_at, m.image_url, m.author_id,
    p.display_name
  FROM (
    SELECT DISTINCT ON (gm.group_id)
      gm.group_id, gm.id, gm.text, gm.created_at, gm.image_url, gm.author_id
    FROM public.group_messages gm
    WHERE gm.group_id = ANY(_group_ids)
      AND gm.deleted_at IS NULL
    ORDER BY gm.group_id, gm.created_at DESC
  ) m
  LEFT JOIN public.profiles p ON p.id = m.author_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_latest_group_messages(uuid[]) TO authenticated;