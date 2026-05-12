
CREATE OR REPLACE FUNCTION public.can_access_chat_group(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_groups cg
    WHERE cg.id = _group_id
      AND (
        (cg.club_id IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = cg.id AND gm.user_id = _user_id
        ))
        OR (cg.club_id IS NOT NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id
            AND ur.club_id = cg.club_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
        OR (cg.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id
            AND ur.team_id = cg.team_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
        OR (cg.mini_league_id IS NOT NULL AND (
          -- Club-wide league admins (and platform app admins for moderation)
          EXISTS (
            SELECT 1 FROM public.user_roles ur
            JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
            WHERE ml.id = cg.mini_league_id
              AND ur.user_id = _user_id
              AND ur.role IN ('league_admin','app_admin')
          )
          -- Per-mini-league granted admins
          OR EXISTS (
            SELECT 1 FROM public.mini_league_admins mla
            WHERE mla.mini_league_id = cg.mini_league_id
              AND mla.user_id = _user_id
          )
          -- Parents of players in this mini-league
          OR EXISTS (
            SELECT 1 FROM public.mini_league_players mlp
            WHERE mlp.mini_league_id = cg.mini_league_id
              AND mlp.parent_user_id = _user_id
          )
        ))
      )
  )
$function$;

DROP POLICY IF EXISTS "Users can access mini league chats" ON public.chat_groups;
CREATE POLICY "Users can access mini league chats"
ON public.chat_groups
FOR SELECT
USING (
  mini_league_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = chat_groups.mini_league_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('league_admin','app_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.mini_league_admins mla
      WHERE mla.mini_league_id = chat_groups.mini_league_id
        AND mla.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.mini_league_players mlp
      WHERE mlp.mini_league_id = chat_groups.mini_league_id
        AND mlp.parent_user_id = auth.uid()
    )
  )
);
