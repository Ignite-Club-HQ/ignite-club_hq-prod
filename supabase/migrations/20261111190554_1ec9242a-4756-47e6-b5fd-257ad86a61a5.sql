CREATE OR REPLACE FUNCTION public._club_media_authorize(_club_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR _club_id IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_club_member(auth.uid(), _club_id)
          OR public.has_role(auth.uid(), 'app_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.competitions c WHERE c.organizer_club_id = _club_id AND public.can_manage_competition_vault(c.id))) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._club_media_authorize(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.club_media_used_bytes(_club_id uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage, pg_temp AS $$
DECLARE v_total bigint;
BEGIN
  PERFORM public._club_media_authorize(_club_id);
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0) INTO v_total
  FROM storage.objects o
  WHERE o.bucket_id IN ('photos','chat-attachments','competition-vault')
    AND (o.name LIKE 'clubs/' || _club_id::text || '/%' OR o.name LIKE _club_id::text || '/%');
  RETURN v_total;
END; $$;
REVOKE ALL ON FUNCTION public.club_media_used_bytes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_media_used_bytes(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_media_storage_breakdown(_club_id uuid)
RETURNS TABLE(team_id text, mini_league_id text, is_image boolean, bytes bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage, pg_temp AS $$
BEGIN
  PERFORM public._club_media_authorize(_club_id);
  RETURN QUERY
  WITH o AS (
    SELECT (o.metadata->>'size')::bigint AS s,
           CASE WHEN o.name LIKE 'clubs/%' THEN regexp_replace(o.name, '^clubs/[^/]+/(vault/)?', '') ELSE '' END AS rest,
           lower(o.name) ~ '\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif|tiff|tif)$' AS img
    FROM storage.objects o
    WHERE o.bucket_id IN ('photos','chat-attachments','competition-vault')
      AND (o.name LIKE 'clubs/' || _club_id::text || '/%' OR o.name LIKE _club_id::text || '/%')
  )
  SELECT CASE WHEN split_part(rest,'/',1)='teams' THEN NULLIF(split_part(rest,'/',2),'') END,
         CASE WHEN split_part(rest,'/',1)='mini-leagues' THEN NULLIF(split_part(rest,'/',2),'') END,
         img, COALESCE(SUM(s),0)::bigint
  FROM o GROUP BY 1,2,3;
END; $$;
REVOKE ALL ON FUNCTION public.club_media_storage_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_media_storage_breakdown(uuid) TO authenticated, service_role;