
-- Add club_admin role for Bridgewater Soccer Club
INSERT INTO public.user_roles (user_id, club_id, role)
VALUES ('c58db9a7-69bd-4f79-9fd7-51b267af124f', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', 'club_admin');

-- Add team_admin role for Tangerinas team
INSERT INTO public.user_roles (user_id, team_id, club_id, role)
VALUES ('c58db9a7-69bd-4f79-9fd7-51b267af124f', 'b0e81b73-1d6b-4fa7-a3a8-c07260287fb2', '966bdaec-ebf1-46da-b2b3-cc53bf05c422', 'team_admin');
