DELETE FROM public.notifications
WHERE type IN ('photo_uploaded','photo_comment','photo_reaction','comment_reaction','comment_reply')
  AND related_id IN (
    SELECT id FROM public.photos
    WHERE created_at >= '2026-04-22 00:00:00+00'
      AND uploader_id = 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc'
  );