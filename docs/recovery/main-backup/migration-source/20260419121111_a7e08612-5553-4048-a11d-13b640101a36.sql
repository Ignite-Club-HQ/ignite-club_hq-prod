CREATE OR REPLACE FUNCTION public.get_photo_view_counts(_photo_ids uuid[])
RETURNS TABLE(photo_id uuid, view_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pv.photo_id, COUNT(*)::bigint AS view_count
  FROM public.photo_views pv
  WHERE pv.photo_id = ANY(_photo_ids)
  GROUP BY pv.photo_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_photo_view_counts(uuid[]) TO authenticated;