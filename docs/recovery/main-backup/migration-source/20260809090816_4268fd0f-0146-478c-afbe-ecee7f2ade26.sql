-- Helper: who may publish CLUB-WIDE media (team_id IS NULL AND mini_league_id IS NULL)
CREATE OR REPLACE FUNCTION public.can_publish_club_wide_photo(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND _club_id IS NOT NULL AND (
    -- App admins may publish club-wide anywhere
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.role = 'app_admin'::app_role
    )
    -- Elevated roles scoped to this exact club (directly, or via a team in this club)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      LEFT JOIN public.teams t ON t.id = ur.team_id
      WHERE ur.user_id = _user_id
        AND ur.role IN (
          'club_admin'::app_role,
          'committee_member'::app_role,
          'team_admin'::app_role,
          'coach'::app_role
        )
        AND (ur.club_id = _club_id OR t.club_id = _club_id)
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.club_member_exclusions cme
    WHERE cme.club_id = _club_id AND cme.user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_publish_club_wide_photo(uuid, uuid) TO authenticated, service_role;

-- Replace the overlapping permissive INSERT policies with one explicit, fail-closed policy
DROP POLICY IF EXISTS "Members can upload photos" ON public.photos;
DROP POLICY IF EXISTS "Users can upload mini-league photos" ON public.photos;

CREATE POLICY "Scoped role-checked photo uploads"
ON public.photos
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL
  AND uploader_id = (SELECT auth.uid())
  AND (
    -- 1. CLUB-WIDE
    (
      team_id IS NULL
      AND mini_league_id IS NULL
      AND club_id IS NOT NULL
      AND public.can_publish_club_wide_photo((SELECT auth.uid()), club_id)
    )
    -- 2. TEAM
    OR (
      team_id IS NOT NULL
      AND mini_league_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = photos.team_id
          AND (photos.club_id IS NULL OR t.club_id = photos.club_id)
      )
      AND (
        public.is_team_member((SELECT auth.uid()), team_id)
        OR public.has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
        OR EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.id = photos.team_id
            AND (
              public.has_role((SELECT auth.uid()), 'club_admin'::app_role, t.club_id, NULL::uuid)
              OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
            )
        )
      )
    )
    -- 3. MINI-LEAGUE
    OR (
      mini_league_id IS NOT NULL
      AND team_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.mini_leagues ml
        WHERE ml.id = photos.mini_league_id
          AND (photos.club_id IS NULL OR ml.club_id = photos.club_id)
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
          WHERE ml.id = photos.mini_league_id
            AND ur.user_id = (SELECT auth.uid())
            AND ur.role = ANY (ARRAY[
              'league_admin'::app_role,
              'coach'::app_role,
              'club_admin'::app_role,
              'app_admin'::app_role
            ])
        )
        OR EXISTS (
          SELECT 1 FROM public.mini_league_players mlp
          WHERE mlp.mini_league_id = photos.mini_league_id
            AND mlp.parent_user_id = (SELECT auth.uid())
        )
      )
    )
  )
);
