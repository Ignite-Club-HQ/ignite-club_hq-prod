
DO $$
DECLARE
  reviewer_id UUID := 'a37b4b18-159b-4ab3-90ad-48eb85456d0d';
  bball_club_id UUID;
  netball_club_id UUID;
BEGIN
  INSERT INTO public.clubs (name, sport, description, city, state, created_by, admin_user_id, is_pro, subscription_status)
  VALUES ('Hoops Demo Basketball Club', 'basketball', 'Demo basketball club for reviewer testing', 'Sydney', 'NSW', reviewer_id, reviewer_id, true, 'active')
  RETURNING id INTO bball_club_id;

  INSERT INTO public.clubs (name, sport, description, city, state, created_by, admin_user_id, is_pro, subscription_status)
  VALUES ('Swish Demo Netball Club', 'netball', 'Demo netball club for reviewer testing', 'Melbourne', 'VIC', reviewer_id, reviewer_id, true, 'active')
  RETURNING id INTO netball_club_id;

  INSERT INTO public.club_subscriptions (club_id, is_pro, plan, admin_pro_override)
  VALUES
    (bball_club_id, true, 'standard', true),
    (netball_club_id, true, 'standard', true);

  INSERT INTO public.user_roles (user_id, club_id, role)
  VALUES
    (reviewer_id, bball_club_id, 'club_admin'),
    (reviewer_id, netball_club_id, 'club_admin')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.teams (club_id, name, level_age, team_type, created_by, default_pitch_format, default_formation)
  VALUES
    (bball_club_id, 'Hoops U12 Eagles', 'U12', 'junior', reviewer_id, '5v5', 'basketball'),
    (bball_club_id, 'Hoops U16 Falcons', 'U16', 'junior', reviewer_id, '5v5', 'basketball'),
    (bball_club_id, 'Hoops Seniors Hawks', 'Senior', 'senior', reviewer_id, '5v5', 'basketball');

  INSERT INTO public.teams (club_id, name, level_age, team_type, created_by, default_pitch_format, default_formation)
  VALUES
    (netball_club_id, 'Swish U13 Sapphires', 'U13', 'junior', reviewer_id, '7v7', 'netball'),
    (netball_club_id, 'Swish U17 Diamonds', 'U17', 'junior', reviewer_id, '7v7', 'netball'),
    (netball_club_id, 'Swish Seniors Pearls', 'Senior', 'senior', reviewer_id, '7v7', 'netball');
END $$;
