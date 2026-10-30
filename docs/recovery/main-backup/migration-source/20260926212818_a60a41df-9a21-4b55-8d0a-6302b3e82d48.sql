CREATE OR REPLACE FUNCTION public.get_manual_group_participants(p_group_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, is_creator boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  -- can_access_chat_group signature is (_user_id, _group_id) — must not be swapped.
  IF NOT (
    public.can_access_chat_group(v_uid, p_group_id)
    OR EXISTS (
      SELECT 1 FROM public.chat_groups cg
      JOIN public.competition_roles cr ON cr.competition_id = cg.competition_id
      WHERE cg.id = p_group_id
        AND cg.competition_id IS NOT NULL
        AND cr.user_id = v_uid
        AND cr.role IN ('owner','admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.role = 'app_admin'
    )
  ) THEN
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
$function$;