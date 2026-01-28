-- Add mini_league_id column to chat_groups table
ALTER TABLE public.chat_groups 
ADD COLUMN mini_league_id uuid REFERENCES public.mini_leagues(id) ON DELETE CASCADE;

-- Create index for mini_league_id
CREATE INDEX idx_chat_groups_mini_league_id ON public.chat_groups(mini_league_id);

-- Create function to auto-create chat group when mini league is created
CREATE OR REPLACE FUNCTION public.create_mini_league_chat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create a chat group for the new mini league
  INSERT INTO public.chat_groups (
    name,
    mini_league_id,
    club_id,
    created_by,
    allowed_roles
  ) VALUES (
    NEW.name || ' Chat',
    NEW.id,
    NEW.club_id,
    NEW.created_by,
    ARRAY['league_admin', 'coach', 'club_admin', 'parent', 'app_admin']::app_role[]
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger for auto-creating mini league chat
CREATE TRIGGER on_mini_league_created_create_chat
  AFTER INSERT ON public.mini_leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.create_mini_league_chat();

-- Create RLS policy for mini league chat access
CREATE POLICY "Users can access mini league chats"
  ON public.chat_groups
  FOR SELECT
  USING (
    mini_league_id IS NOT NULL AND (
      -- League admins, coaches, and club admins
      EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN mini_leagues ml ON ml.club_id = ur.club_id
        WHERE ml.id = mini_league_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
      )
      OR
      -- Parents with children in the league
      EXISTS (
        SELECT 1 FROM mini_league_players mlp
        WHERE mlp.mini_league_id = chat_groups.mini_league_id
        AND mlp.parent_user_id = auth.uid()
      )
    )
  );

-- Create function to check if user can access mini league chat
CREATE OR REPLACE FUNCTION public.can_access_mini_league_chat(_user_id uuid, _mini_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- League admins, coaches, and club admins
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = _mini_league_id
    AND ur.user_id = _user_id
    AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
  )
  OR EXISTS (
    -- Parents with children in the league
    SELECT 1 FROM mini_league_players mlp
    WHERE mlp.mini_league_id = _mini_league_id
    AND mlp.parent_user_id = _user_id
  )
$$;