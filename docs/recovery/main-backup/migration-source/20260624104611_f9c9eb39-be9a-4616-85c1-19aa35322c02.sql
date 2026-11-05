DROP FUNCTION IF EXISTS public.get_club_free_usage(uuid);

CREATE OR REPLACE FUNCTION public.get_club_free_usage(_club_id uuid)
RETURNS TABLE(
  cycle_start timestamptz,
  cycle_end timestamptz,
  photo_uploads_this_cycle integer,
  photo_storage_bytes bigint,
  chat_photo_uploads_this_cycle integer,
  chat_file_uploads_this_cycle integer,
  chat_file_storage_bytes bigint,
  file_count integer,
  file_storage_bytes bigint,
  polls_this_cycle integer,
  is_pro boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created timestamptz;
  v_cycle_start timestamptz;
  v_cycle_end timestamptz;
  v_is_pro boolean := false;
BEGIN
  SELECT created_at INTO v_created FROM public.clubs WHERE id = _club_id;
  IF v_created IS NULL THEN
    RETURN;
  END IF;

  v_cycle_start := v_created + (floor(extract(epoch FROM (now() - v_created)) / (30 * 86400))::int) * INTERVAL '30 days';
  v_cycle_end := v_cycle_start + INTERVAL '30 days';

  SELECT COALESCE(
    (cs.is_pro OR cs.is_pro_football OR cs.admin_pro_override OR cs.admin_pro_football_override)
    AND (cs.expires_at IS NULL OR cs.expires_at > now()),
    false
  )
  INTO v_is_pro
  FROM public.club_subscriptions cs
  WHERE cs.club_id = _club_id;
  v_is_pro := COALESCE(v_is_pro, false);

  cycle_start := v_cycle_start;
  cycle_end := v_cycle_end;
  is_pro := v_is_pro;

  SELECT COUNT(*) FILTER (WHERE created_at >= v_cycle_start)::int,
         COALESCE(SUM(file_size) FILTER (WHERE created_at >= v_cycle_start), 0)::bigint
    INTO photo_uploads_this_cycle, photo_storage_bytes
  FROM public.photos WHERE club_id = _club_id;

  SELECT COUNT(*)::int
    INTO chat_photo_uploads_this_cycle
  FROM public.vault_files vf
  JOIN public.vault_folders vfo ON vfo.id = vf.folder_id
  WHERE vf.club_id = _club_id
    AND vf.deleted_at IS NULL
    AND vf.created_at >= v_cycle_start
    AND vfo.name = 'Chat Images';

  -- Chat file attachments: vault_files inserted from the chat composer have no folder_id.
  SELECT COUNT(*)::int, COALESCE(SUM(vf.file_size), 0)::bigint
    INTO chat_file_uploads_this_cycle, chat_file_storage_bytes
  FROM public.vault_files vf
  WHERE vf.club_id = _club_id
    AND vf.deleted_at IS NULL
    AND vf.created_at >= v_cycle_start
    AND vf.folder_id IS NULL
    AND vf.is_external_link = false;

  -- Vault file uploads: files placed inside a vault folder (excluding auto-sync folders).
  SELECT COUNT(*)::int, COALESCE(SUM(vf.file_size), 0)::bigint
    INTO file_count, file_storage_bytes
  FROM public.vault_files vf
  JOIN public.vault_folders vfo ON vfo.id = vf.folder_id
  WHERE vf.club_id = _club_id
    AND vf.deleted_at IS NULL
    AND vf.created_at >= v_cycle_start
    AND vfo.chat_group_id IS NULL
    AND vfo.name NOT IN ('Gallery Uploads', 'Chat Images', 'Chat Links', 'Club Admin Chat');

  SELECT COUNT(*)::int INTO polls_this_cycle
  FROM public.polls p
  WHERE p.created_at >= v_cycle_start
    AND (
      (p.chat_type = 'club' AND p.chat_id = _club_id)
      OR (p.chat_type = 'team' AND p.chat_id IN (SELECT id FROM public.teams WHERE club_id = _club_id))
      OR (p.chat_type = 'group' AND p.chat_id IN (SELECT id FROM public.chat_groups WHERE club_id = _club_id))
    );

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_club_free_usage(uuid) TO authenticated, service_role;