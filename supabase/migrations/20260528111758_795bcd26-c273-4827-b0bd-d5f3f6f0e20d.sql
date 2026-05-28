UPDATE public.chat_groups
SET allowed_roles = array_append(allowed_roles, 'club_admin'::app_role)
WHERE id IN (
  '3712d7ea-d1f7-4cb2-85c5-94cda4a6f5e6',
  '6fdbc068-a41b-4aa1-b12d-c3cc16386d62',
  'f891837d-e1b1-4f1a-bcc7-def3dc2d4c40'
)
AND NOT ('club_admin'::app_role = ANY(allowed_roles));