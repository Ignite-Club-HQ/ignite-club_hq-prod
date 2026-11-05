
-- Add Adam Jackson to U11 White as parent and coach
INSERT INTO public.user_roles (user_id, club_id, team_id, role)
VALUES
  ('5a3e6f1d-5efb-4afc-9c64-7dc8fb905062', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', '2a28bdb5-bda9-4cb6-8d7c-542af8ff8518', 'parent'),
  ('5a3e6f1d-5efb-4afc-9c64-7dc8fb905062', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', '2a28bdb5-bda9-4cb6-8d7c-542af8ff8518', 'coach')
ON CONFLICT DO NOTHING;
