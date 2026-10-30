-- Decline Adam's two pending U11 Blue role requests
UPDATE public.role_requests
SET status = 'denied',
    processed_by = NULL,
    updated_at = now()
WHERE id IN (
  '15cbb01f-f116-4625-9fe6-cd0d9cd15dbb', -- coach request 2026-04-24
  '8f3d1bbb-acd7-445f-a501-0ff79a9a185a'  -- parent request 2026-04-17
);

-- Link Adam as a secondary guardian on the real Harry Jackson (U11 White)
INSERT INTO public.child_guardians (child_id, guardian_id, is_primary, relationship_type)
VALUES ('90090e3a-0b24-4df9-a2d8-efc9568bbb6e', '5a3e6f1d-5efb-4afc-9c64-7dc8fb905062', false, 'parent')
ON CONFLICT DO NOTHING;

-- Delete the duplicate empty Harry Jackson child owned by Adam (no team assignment, no guardians)
DELETE FROM public.children
WHERE id = '3d6971e8-b79c-4269-aa0c-8a17f8f61f41'
  AND parent_id = '5a3e6f1d-5efb-4afc-9c64-7dc8fb905062';