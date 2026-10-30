
-- Allow children to exist without an assigned parent user (e.g., pending parent invite)
ALTER TABLE public.children ALTER COLUMN parent_id DROP NOT NULL;

-- Fix mis-attributed children created by mini-league invite flow
UPDATE public.children
SET parent_id = NULL
WHERE id IN (
  '1e0c2042-d337-4868-b3b7-849f236b37cf',
  '9f038988-524d-4981-b787-55be60cbbfea'
)
AND parent_id = 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc';
