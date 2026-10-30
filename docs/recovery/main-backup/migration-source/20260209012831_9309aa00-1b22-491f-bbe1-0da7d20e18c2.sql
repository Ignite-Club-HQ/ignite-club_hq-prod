-- Create club DM settings table
CREATE TABLE IF NOT EXISTS public.club_dm_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  dm_enabled boolean NOT NULL DEFAULT true,
  allowed_roles text[] NOT NULL DEFAULT ARRAY['app_admin', 'club_admin', 'team_admin']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(club_id)
);

-- Enable RLS
ALTER TABLE public.club_dm_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read settings (needed to check permissions)
CREATE POLICY "Authenticated users can read club DM settings"
ON public.club_dm_settings FOR SELECT
TO authenticated
USING (true);

-- Only club admins can modify their club's settings
CREATE POLICY "Club admins can manage their club DM settings"
ON public.club_dm_settings FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'club_admin', club_id, NULL) OR public.has_role(auth.uid(), 'app_admin', NULL, NULL))
WITH CHECK (public.has_role(auth.uid(), 'club_admin', club_id, NULL) OR public.has_role(auth.uid(), 'app_admin', NULL, NULL));

-- Add updated_at trigger
CREATE TRIGGER update_club_dm_settings_updated_at
BEFORE UPDATE ON public.club_dm_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Drop and recreate can_dm_user function with new logic
DROP FUNCTION IF EXISTS public.can_dm_user(uuid);

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
  other_user_role TEXT;
  allowed_roles_arr TEXT[];
  dm_enabled_flag BOOLEAN;
BEGIN
  -- Can't DM yourself
  IF current_user_id = other_user_id THEN
    RETURN FALSE;
  END IF;
  
  -- Check if other_user is the system support user (always allow receiving from them)
  IF other_user_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RETURN TRUE;
  END IF;
  
  -- Check if current user is the system support user (always allow sending)
  IF current_user_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
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