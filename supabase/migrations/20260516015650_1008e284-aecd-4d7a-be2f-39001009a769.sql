
INSERT INTO public.user_roles (user_id, club_id, team_id, role)
VALUES
  ('4649ab0e-9d50-4b6e-a01d-e71cba94fcfd', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', '5404c1e0-0c28-4c7a-841a-d207a2aa11c8', 'parent'),
  ('4649ab0e-9d50-4b6e-a01d-e71cba94fcfd', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', '434ced2d-977f-4af3-a650-8aec26dc20be', 'parent')
ON CONFLICT DO NOTHING;
