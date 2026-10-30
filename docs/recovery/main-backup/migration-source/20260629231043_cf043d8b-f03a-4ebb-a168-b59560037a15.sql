
CREATE OR REPLACE FUNCTION public.get_manual_group_participants(p_group_id uuid)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, is_creator boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.can_access_chat_group(p_group_id, v_uid) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    p.avatar_url,
    (cg.created_by = p.id) AS is_creator
  FROM public.group_members gm
  JOIN public.chat_groups cg ON cg.id = gm.group_id
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_manual_group_participants(uuid) TO authenticated;
