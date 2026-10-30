-- Free-tier usage accounting for clubs.
-- Anchors monthly counters (photos, polls) to a 30-day cycle from clubs.created_at.

CREATE OR REPLACE FUNCTION public.get_club_free_usage(_club_id uuid)
RETURNS TABLE(
  cycle_start timestamptz,
  cycle_end timestamptz,
  photo_uploads_this_cycle integer,
  photo_storage_bytes bigint,
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

  -- 30-day cycle anchored to signup date
  v_cycle_start := v_created + (floor(extract(epoch FROM (now() - v_created)) / (30 * 86400))::int) * INTERVAL '30 days';
  v_cycle_end := v_cycle_start + INTERVAL '30 days';

  -- Pro status (mirrors useClubProAccess logic)
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

  SELECT COUNT(*)::int, COALESCE(SUM(file_size), 0)::bigint
    INTO photo_uploads_this_cycle, photo_storage_bytes
  FROM (
    SELECT created_at, file_size FROM public.photos WHERE club_id = _club_id
  ) p;
  -- recompute split — first call only filled cycle count incorrectly
  SELECT COUNT(*) FILTER (WHERE created_at >= v_cycle_start)::int,
         COALESCE(SUM(file_size), 0)::bigint
    INTO photo_uploads_this_cycle, photo_storage_bytes
  FROM public.photos WHERE club_id = _club_id;

  SELECT COUNT(*)::int, COALESCE(SUM(file_size), 0)::bigint
    INTO file_count, file_storage_bytes
  FROM public.vault_files
  WHERE club_id = _club_id AND COALESCE(deleted_at, NULL) IS NULL;

  SELECT COUNT(*) FILTER (WHERE created_at >= v_cycle_start)::int
    INTO polls_this_cycle
  FROM public.polls WHERE club_id = _club_id;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_club_free_usage(uuid) TO authenticated, service_role;