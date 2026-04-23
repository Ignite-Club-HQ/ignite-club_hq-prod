INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES ('0f165b87-d589-4a88-9c20-5a24abf9c753', '681a5e0f-fc8e-47ed-8682-29f6c56c42dc', 'parent', false)
ON CONFLICT DO NOTHING;