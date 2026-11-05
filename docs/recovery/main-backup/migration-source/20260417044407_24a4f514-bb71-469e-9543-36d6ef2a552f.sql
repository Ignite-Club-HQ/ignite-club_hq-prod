-- Link Heidi Crawford as guardian of Henry Saunders (Angus stays primary parent)
INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES (
  'd183d3c7-8da2-4c78-87b7-f7f72505964c'::uuid,
  'ad03ef9b-eeb1-4861-a9a7-65897cc003d9'::uuid,
  'parent',
  false
)
ON CONFLICT DO NOTHING;

-- Audit
INSERT INTO public.audit_logs (action_type, actor_id, target_user_id, target_user_name, details)
VALUES (
  'guardian_linked',
  NULL,
  'ad03ef9b-eeb1-4861-a9a7-65897cc003d9'::uuid,
  'Heidi Crawford',
  jsonb_build_object(
    'child_id', 'd183d3c7-8da2-4c78-87b7-f7f72505964c',
    'child_name', 'Henry Saunders',
    'team', 'U8 White',
    'relationship_type', 'parent',
    'is_primary', false,
    'reason', 'Manual link — Heidi is Henry''s parent; Angus remains primary'
  )
);