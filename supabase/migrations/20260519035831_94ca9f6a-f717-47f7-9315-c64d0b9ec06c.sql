-- 1) Add membership_mode column to chat_groups
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS membership_mode text NOT NULL DEFAULT 'role';

ALTER TABLE public.chat_groups
  DROP CONSTRAINT IF EXISTS chat_groups_membership_mode_check;

ALTER TABLE public.chat_groups
  ADD CONSTRAINT chat_groups_membership_mode_check
  CHECK (membership_mode IN ('role','manual'));

-- 2) Update access function to honour membership_mode
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
        -- Personal groups (no club/team/league scope): always manual membership
        (cg.club_id IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = cg.id AND gm.user_id = _user_id
        ))

        -- Scoped groups in MANUAL mode: only explicit members, plus club/app admins for moderation
        OR (
          cg.membership_mode = 'manual'
          AND (cg.club_id IS NOT NULL OR cg.team_id IS NOT NULL OR cg.mini_league_id IS NOT NULL)
          AND (
            EXISTS (
              SELECT 1 FROM public.group_members gm
              WHERE gm.group_id = cg.id AND gm.user_id = _user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = _user_id
                AND ur.role IN ('club_admin','app_admin')
                AND (
                  (cg.club_id IS NOT NULL AND ur.club_id = cg.club_id)
                  OR ur.role = 'app_admin'
                )
            )
          )
        )

        -- Scoped groups in ROLE mode: existing logic
        OR (
          cg.membership_mode = 'role'
          AND cg.club_id IS NOT NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.club_id = cg.club_id
              AND ur.role = ANY(cg.allowed_roles)
          )
        )
        OR (
          cg.membership_mode = 'role'
          AND cg.team_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.team_id = cg.team_id
              AND ur.role = ANY(cg.allowed_roles)
          )
        )
        OR (
          cg.membership_mode = 'role'
          AND cg.mini_league_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM public.user_roles ur
              JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
              WHERE ml.id = cg.mini_league_id
                AND ur.user_id = _user_id
                AND ur.role IN ('league_admin','club_admin','app_admin')
            )
            OR EXISTS (
              SELECT 1 FROM public.mini_league_admins mla
              WHERE mla.mini_league_id = cg.mini_league_id
                AND mla.user_id = _user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.mini_league_players mlp
              WHERE mlp.mini_league_id = cg.mini_league_id
                AND mlp.parent_user_id = _user_id
            )
          )
        )
      )
  )
$function$;

-- 3) Update the chat_groups SELECT policy for mini-league chats to also honour manual mode
DROP POLICY IF EXISTS "Users can access mini league chats" ON public.chat_groups;
CREATE POLICY "Users can access mini league chats"
ON public.chat_groups
FOR SELECT
USING (
  mini_league_id IS NOT NULL AND (
    (membership_mode = 'manual' AND (
      EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = chat_groups.id AND gm.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin')
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
        WHERE ml.id = chat_groups.mini_league_id
          AND ur.user_id = auth.uid()
          AND ur.role = 'club_admin'
      )
    ))
    OR (membership_mode = 'role' AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
        WHERE ml.id = chat_groups.mini_league_id
          AND ur.user_id = auth.uid()
          AND ur.role IN ('league_admin','club_admin','app_admin')
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
    ))
  )
);