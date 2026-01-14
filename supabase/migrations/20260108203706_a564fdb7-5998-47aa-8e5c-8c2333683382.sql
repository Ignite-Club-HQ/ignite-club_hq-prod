
-- Assign roles to demo users across the 3 demo clubs
DO $$
DECLARE
  demo_user RECORD;
  user_count INT := 0;
  club_ids UUID[] := ARRAY['3f2d97f5-f5c6-4309-b8b2-161641a4adb4', '06964880-3172-4533-94ca-6ed417798600', '36231b76-5313-478e-b8d5-23ac4f5e8b10'];
  team_ids_eastside UUID[] := ARRAY['b99cdb21-e531-4098-a36b-3290c4659e75', '26755f6b-4c33-4eb8-9c2f-66ed5407fad0', '2e945451-afc6-488d-abce-090e28baf135'];
  team_ids_northern UUID[] := ARRAY['a22f738b-280c-4e76-a846-caddd2f76f73', 'b6e0f54c-4449-4465-9132-e48a3d62c90b', 'a5605fc0-b897-4755-a8fd-581b42a5dac1'];
  team_ids_riverside UUID[] := ARRAY['2a8f1436-9be3-419c-a545-f948afc6739b', 'f6d66ea0-eeb7-4ace-aa2a-28c3d29b124e', '0715a270-5693-4409-9455-97e257efc019'];
  v_club_id UUID;
  v_team_id UUID;
  v_role app_role;
BEGIN
  FOR demo_user IN 
    SELECT u.id 
    FROM auth.users u
    WHERE u.email LIKE '%@demo.local'
    ORDER BY u.email
  LOOP
    -- Assign to different clubs based on user_count
    IF user_count % 3 = 0 THEN
      v_club_id := club_ids[1];
      v_team_id := team_ids_eastside[(user_count % 3) + 1];
    ELSIF user_count % 3 = 1 THEN
      v_club_id := club_ids[2];
      v_team_id := team_ids_northern[(user_count % 3) + 1];
    ELSE
      v_club_id := club_ids[3];
      v_team_id := team_ids_riverside[(user_count % 3) + 1];
    END IF;

    -- Assign different roles based on position
    IF user_count < 3 THEN
      v_role := 'club_admin'::app_role;
    ELSIF user_count < 12 THEN
      v_role := 'coach'::app_role;
    ELSIF user_count < 21 THEN
      v_role := 'team_admin'::app_role;
    ELSIF user_count < 60 THEN
      v_role := 'player'::app_role;
    ELSE
      v_role := 'parent'::app_role;
    END IF;

    -- Insert role
    INSERT INTO public.user_roles (user_id, role, club_id, team_id)
    VALUES (demo_user.id, v_role, v_club_id, v_team_id);

    user_count := user_count + 1;
  END LOOP;
END $$;
