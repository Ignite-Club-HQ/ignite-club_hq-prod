DELETE FROM public.notifications
WHERE related_id IN (
  '2cf45488-8e8e-4488-8653-db05b9fd952a',
  '0486a1dd-c689-4a00-b425-44e415bbcc7e',
  '6459c543-4bc7-4519-818e-25e13e32a179',
  '0e90f7df-f371-41df-8275-b66a9a2675b8'
)
AND type IN ('photo_uploaded','photo_comment','photo_reaction','comment_reaction','comment_reply');