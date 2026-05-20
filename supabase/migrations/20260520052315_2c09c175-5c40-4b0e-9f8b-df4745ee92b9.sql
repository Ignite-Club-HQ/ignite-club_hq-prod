CREATE OR REPLACE FUNCTION public.get_inbox_latest_dm_messages(_conversation_ids uuid[])
RETURNS TABLE (
  conversation_id uuid,
  message_id uuid,
  text text,
  image_url text,
  created_at timestamptz,
  author_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (dm.conversation_id)
    dm.conversation_id,
    dm.id AS message_id,
    dm.text,
    dm.image_url,
    dm.created_at,
    dm.author_id
  FROM public.direct_messages dm
  WHERE dm.conversation_id = ANY(_conversation_ids)
  ORDER BY dm.conversation_id, dm.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_latest_dm_messages(uuid[]) TO authenticated;