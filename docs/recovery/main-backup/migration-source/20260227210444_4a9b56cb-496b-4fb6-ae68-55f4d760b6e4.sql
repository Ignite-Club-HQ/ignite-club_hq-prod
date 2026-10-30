
-- Add reviewer as club_admin on Eastside Athletic (non-pro club, so reviewer can see upgrade screens)
INSERT INTO user_roles (user_id, role, club_id)
VALUES ('a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'club_admin', '3f2d97f5-f5c6-4309-b8b2-161641a4adb4')
ON CONFLICT DO NOTHING;

-- Add reviewer as team_admin on Varsity Boys (Eastside Athletic, non-pro team for team upgrade screen)
INSERT INTO user_roles (user_id, role, team_id, club_id)
VALUES ('a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'team_admin', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', '3f2d97f5-f5c6-4309-b8b2-161641a4adb4')
ON CONFLICT DO NOTHING;

-- Also add team_admin on a Riverside FC team so reviewer can see team upgrade there too
INSERT INTO user_roles (user_id, role, team_id, club_id)
VALUES ('a37b4b18-159b-4ab3-90ad-48eb85456d0d', 'team_admin', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', '36231b76-5313-478e-b8d5-23ac4f5e8b10')
ON CONFLICT DO NOTHING;
