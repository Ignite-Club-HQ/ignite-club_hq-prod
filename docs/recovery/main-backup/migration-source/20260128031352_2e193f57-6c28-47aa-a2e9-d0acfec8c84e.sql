-- Update can_access_chat_group function to handle mini league chats
CREATE OR REPLACE FUNCTION public.can_access_chat_group(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.chat_groups cg
    WHERE cg.id = _group_id
      AND (
        -- Personal groups: user must be in group_members
        (cg.club_id IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.group_members gm 
          WHERE gm.group_id = cg.id AND gm.user_id = _user_id
        ))
        -- Club groups: user must be a member of the club with an allowed role
        OR (cg.club_id IS NOT NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id 
            AND ur.club_id = cg.club_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
        -- Team groups: user must be a member of the team with an allowed role
        OR (cg.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id 
            AND ur.team_id = cg.team_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
        -- Mini league groups: user must be league admin/coach or parent in the league
        OR (cg.mini_league_id IS NOT NULL AND (
          -- League admins, coaches, and club admins
          EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN mini_leagues ml ON ml.club_id = ur.club_id
            WHERE ml.id = cg.mini_league_id
            AND ur.user_id = _user_id
            AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
          )
          OR
          -- Parents with children in the league
          EXISTS (
            SELECT 1 FROM mini_league_players mlp
            WHERE mlp.mini_league_id = cg.mini_league_id
            AND mlp.parent_user_id = _user_id
          )
        ))
      )
  )
$$;