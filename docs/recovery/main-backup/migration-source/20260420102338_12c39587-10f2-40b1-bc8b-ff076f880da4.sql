ALTER TABLE public.photo_views DROP CONSTRAINT IF EXISTS photo_views_photo_id_user_id_key;

CREATE OR REPLACE FUNCTION public.get_photo_view_counts(_photo_ids uuid[])
RETURNS TABLE(photo_id uuid, view_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pv.photo_id, COUNT(*)::bigint AS view_count
  FROM public.photo_views pv
  JOIN public.photos p ON p.id = pv.photo_id
  WHERE pv.photo_id = ANY(_photo_ids)
    AND pv.user_id <> p.uploader_id
  GROUP BY pv.photo_id;
$$;