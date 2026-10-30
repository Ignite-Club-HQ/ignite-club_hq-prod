-- Add Amy as guardian of Florence Nolan
INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES ('1d360441-c289-4048-94fd-575deed1a2b1', '78188ef4-3dd7-4f37-9092-5c631a5836d8', 'parent', false)
ON CONFLICT DO NOTHING;

-- Add Amy as team_admin (manager) of U7 Girls
INSERT INTO public.user_roles (user_id, role, club_id, team_id)
VALUES ('78188ef4-3dd7-4f37-9092-5c631a5836d8', 'team_admin', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', '16131f5b-afaa-478b-a0ef-5a9be0889e59')
ON CONFLICT DO NOTHING;

-- Also add a parent role on the team so she sees it as a parent
INSERT INTO public.user_roles (user_id, role, club_id, team_id)
VALUES ('78188ef4-3dd7-4f37-9092-5c631a5836d8', 'parent', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', '16131f5b-afaa-478b-a0ef-5a9be0889e59')
ON CONFLICT DO NOTHING;