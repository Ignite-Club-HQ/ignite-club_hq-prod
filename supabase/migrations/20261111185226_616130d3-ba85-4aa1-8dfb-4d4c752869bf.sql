CREATE OR REPLACE FUNCTION public.club_media_used_bytes(_club_id uuid)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage, pg_temp
AS $$
DECLARE v_total bigint;
BEGIN
  IF auth.uid() IS NULL OR _club_id IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_club_member(auth.uid(), _club_id)
          OR public.has_role(auth.uid(), 'app_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.competitions c WHERE c.organizer_club_id = _club_id AND public.can_manage_competition_vault(c.id))) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0) INTO v_total
  FROM storage.objects o
  WHERE o.bucket_id IN ('photos','chat-attachments','competition-vault')
    AND o.name LIKE 'clubs/' || _club_id::text || '/%';
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.club_media_used_bytes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_media_used_bytes(uuid) TO authenticated, service_role;