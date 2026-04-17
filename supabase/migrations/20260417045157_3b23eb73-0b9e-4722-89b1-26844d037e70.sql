INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES (
  'd020b6d8-e01b-4708-8d78-1c8e3fea5578'::uuid,
  'e240c80b-41cb-4e28-a42c-c3396039f34b'::uuid,
  'parent',
  false
)
ON CONFLICT DO NOTHING;

INSERT INTO public.audit_logs (action_type, actor_id, target_user_id, target_user_name, details)
VALUES (
  'guardian_linked',
  NULL,
  'e240c80b-41cb-4e28-a42c-c3396039f34b'::uuid,
  'Tobi Irish',
  jsonb_build_object(
    'child_id', 'd020b6d8-e01b-4708-8d78-1c8e3fea5578',
    'child_name', 'Freddie Irish',
    'team', 'U8 White',
    'relationship_type', 'parent',
    'is_primary', false,
    'reason', 'Manual link — Tobi is Freddie''s parent alongside Bridie'
  )
);