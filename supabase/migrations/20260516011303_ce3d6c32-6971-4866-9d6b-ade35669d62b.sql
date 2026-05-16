-- Link Aja as guardian to David's children Finn & Theodore Scarborough
INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES
  ('10340dde-024e-4686-a6bf-18570467ab9c', '4649ab0e-9d50-4b6e-a01d-e71cba94fcfd', 'parent', false),
  ('36f0dcaa-57b3-42e2-ba87-57cf81b5666f', '4649ab0e-9d50-4b6e-a01d-e71cba94fcfd', 'parent', false)
ON CONFLICT DO NOTHING;

-- Ensure David is also recorded as guardian (primary) for consistency
INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES
  ('10340dde-024e-4686-a6bf-18570467ab9c', '4a362d73-336e-4fe6-aa46-e722860bd5e1', 'parent', true),
  ('36f0dcaa-57b3-42e2-ba87-57cf81b5666f', '4a362d73-336e-4fe6-aa46-e722860bd5e1', 'parent', true)
ON CONFLICT DO NOTHING;

-- Remove Aja's duplicate Finn Scarborough (no team/guardian/club_player links)
DELETE FROM public.children WHERE id = 'd4fb717a-77b4-4cef-92ec-82d4436497b6';