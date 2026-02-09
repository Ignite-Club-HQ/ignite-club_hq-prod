-- Fix the system user ID in can_dm_user function (use correct ID: ...0001)
CREATE OR REPLACE FUNCTION public.can_dm_user(other_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  shared_pro_club_id UUID;
  dm_allowed BOOLEAN := FALSE;
  current_user_role TEXT;
  allowed_roles_arr TEXT[];
  dm_enabled_flag BOOLEAN;
  ignite_support_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  -- Can't DM yourself
  IF current_user_id = other_user_id THEN
    RETURN FALSE;
  END IF;
  
  -- Check if other_user is the system support user (always allow receiving from them)
  IF other_user_id = ignite_support_id THEN
    RETURN TRUE;
  END IF;
  
  -- Check if current user is the system support user (always allow sending)
  IF current_user_id = ignite_support_id THEN
    RETURN TRUE;
  END IF;
  
  -- App admins can always DM anyone
  IF EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = current_user_id AND role = 'app_admin'
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Find a shared Pro club
  SELECT cs.club_id INTO shared_pro_club_id
  FROM user_roles ur1
  JOIN user_roles ur2 ON ur1.club_id = ur2.club_id
  JOIN club_subscriptions cs ON cs.club_id = ur1.club_id
  WHERE ur1.user_id = current_user_id
    AND ur2.user_id = other_user_id
    AND ur1.club_id IS NOT NULL
    AND (cs.is_pro = true OR cs.is_pro_football = true OR cs.admin_pro_override = true OR cs.admin_pro_football_override = true)
    AND (cs.expires_at IS NULL OR cs.expires_at > now())
  LIMIT 1;
  
  IF shared_pro_club_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Check club DM settings
  SELECT dm_enabled, allowed_roles 
  INTO dm_enabled_flag, allowed_roles_arr
  FROM club_dm_settings
  WHERE club_id = shared_pro_club_id;
  
  -- If no settings exist, use defaults (enabled, admin roles only)
  IF dm_enabled_flag IS NULL THEN
    dm_enabled_flag := TRUE;
    allowed_roles_arr := ARRAY['app_admin', 'club_admin', 'team_admin']::TEXT[];
  END IF;
  
  -- If DMs are disabled for this club, deny
  IF NOT dm_enabled_flag THEN
    RETURN FALSE;
  END IF;
  
  -- Check if current user has an allowed role in the shared club
  SELECT ur.role INTO current_user_role
  FROM user_roles ur
  WHERE ur.user_id = current_user_id
    AND ur.club_id = shared_pro_club_id
    AND ur.role = ANY(allowed_roles_arr)
  LIMIT 1;
  
  IF current_user_role IS NOT NULL THEN
    RETURN TRUE;
  END IF;
  
  -- Also check if user has allowed team role in a team belonging to the club
  SELECT ur.role INTO current_user_role
  FROM user_roles ur
  JOIN teams t ON t.id = ur.team_id
  WHERE ur.user_id = current_user_id
    AND t.club_id = shared_pro_club_id
    AND ur.role = ANY(allowed_roles_arr)
  LIMIT 1;
  
  IF current_user_role IS NOT NULL THEN
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$;