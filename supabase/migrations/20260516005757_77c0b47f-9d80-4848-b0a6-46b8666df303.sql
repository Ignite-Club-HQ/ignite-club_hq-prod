
-- Helper: can the current user control the pitch board for this team / event?
-- True for: team_admin on the team, club_admin on the club that owns the team,
-- or anyone assigned the "Subs Manager" duty on the linked event.
CREATE OR REPLACE FUNCTION public.can_control_pitch_board(_team_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Team admin on this team
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.team_id = _team_id
        AND ur.role = 'team_admin'
    )
    -- Club admin on the club that owns this team
    OR EXISTS (
      SELECT 1
      FROM public.teams t
      JOIN public.user_roles ur ON ur.club_id = t.club_id
      WHERE t.id = _team_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('club_admin', 'app_admin')
    )
    -- Subs Manager duty assignee for the linked event
    OR (
      _event_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.duties d
        WHERE d.event_id = _event_id
          AND d.name = 'Subs Manager'
          AND d.assigned_to = auth.uid()
      )
    )
    -- Fallback: if no linked event was supplied, allow if user has Subs Manager
    -- on any upcoming/current game event for this team (covers the "started
    -- without linking" path).
    OR (
      _event_id IS NULL AND _team_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.duties d
        JOIN public.events e ON e.id = d.event_id
        WHERE d.name = 'Subs Manager'
          AND d.assigned_to = auth.uid()
          AND e.team_id = _team_id
          AND e.type = 'game'
          AND e.event_date > (now() - interval '6 hours')
          AND e.event_date < (now() + interval '12 hours')
      )
    );
$$;

-- Replace per-user write policies with role-based shared-write policies.
DROP POLICY IF EXISTS "Users can create their own games" ON public.active_games;
DROP POLICY IF EXISTS "Users can update their own games" ON public.active_games;
DROP POLICY IF EXISTS "Users can delete their own games" ON public.active_games;

-- SELECT policies already in place ("Team members can view team games" +
-- "App admins can view all active games") cover read access for spectators.

CREATE POLICY "Controllers can create team active games"
ON public.active_games
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND team_id IS NOT NULL
  AND public.can_control_pitch_board(
    team_id,
    NULLIF((pitch_state->>'linkedEventId')::text, '')::uuid
  )
);

CREATE POLICY "Controllers can update team active games"
ON public.active_games
FOR UPDATE
USING (
  team_id IS NOT NULL
  AND public.can_control_pitch_board(
    team_id,
    NULLIF((pitch_state->>'linkedEventId')::text, '')::uuid
  )
)
WITH CHECK (
  team_id IS NOT NULL
  AND public.can_control_pitch_board(
    team_id,
    NULLIF((pitch_state->>'linkedEventId')::text, '')::uuid
  )
);

-- Allow the original creator to still update their own non-team-scoped legacy
-- rows (e.g. user_id-only rows with team_id NULL). Mirrors prior behaviour.
CREATE POLICY "Owners can update their personal active games"
ON public.active_games
FOR UPDATE
USING (auth.uid() = user_id AND team_id IS NULL)
WITH CHECK (auth.uid() = user_id AND team_id IS NULL);

CREATE POLICY "Owners can create personal active games"
ON public.active_games
FOR INSERT
WITH CHECK (auth.uid() = user_id AND team_id IS NULL);

-- No client DELETE. Game-end flips is_active = false via UPDATE.
