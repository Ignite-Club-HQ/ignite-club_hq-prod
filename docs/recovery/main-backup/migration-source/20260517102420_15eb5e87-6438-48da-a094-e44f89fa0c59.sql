
-- Add Claire Falconer as parent on same teams and children as James Falconer
INSERT INTO public.user_roles (user_id, club_id, team_id, role) VALUES
  ('b95e1c20-f1c6-4112-8375-2a889cb73480','966bdaec-ebf1-46da-b2b3-cc53bf05c422','5404c1e0-0c28-4c7a-841a-d207a2aa11c8','parent'),
  ('b95e1c20-f1c6-4112-8375-2a889cb73480','966bdaec-ebf1-46da-b2b3-cc53bf05c422','434ced2d-977f-4af3-a650-8aec26dc20be','parent')
ON CONFLICT DO NOTHING;

INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary) VALUES
  ('3c52e2af-8308-41df-8a8e-648fab49b215','b95e1c20-f1c6-4112-8375-2a889cb73480','parent',false),
  ('e10621de-ab2f-45bf-8057-a7be24ea7f65','b95e1c20-f1c6-4112-8375-2a889cb73480','parent',false),
  ('57071fcb-ae25-4a57-a809-e5ab75ab02be','b95e1c20-f1c6-4112-8375-2a889cb73480','parent',false)
ON CONFLICT DO NOTHING;
