DELETE FROM public.notifications
WHERE type = 'photo_uploaded'
  AND related_id IN (
    SELECT id FROM public.photos
    WHERE uploader_id = 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc'
  );