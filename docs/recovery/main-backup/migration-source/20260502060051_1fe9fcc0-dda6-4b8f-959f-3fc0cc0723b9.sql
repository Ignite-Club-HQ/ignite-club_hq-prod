
-- Allow soccer sport in game_results
ALTER TABLE public.game_results DROP CONSTRAINT IF EXISTS game_results_sport_check;
ALTER TABLE public.game_results ADD CONSTRAINT game_results_sport_check
  CHECK (sport = ANY (ARRAY['basketball'::text, 'netball'::text, 'soccer'::text]));

-- Unique partial index on event_id so upsert(onConflict: 'event_id') works
CREATE UNIQUE INDEX IF NOT EXISTS game_results_event_id_unique
  ON public.game_results (event_id) WHERE event_id IS NOT NULL;

-- Helper to detect Subs Manager duty for an event
CREATE OR REPLACE FUNCTION public.is_subs_manager_for_event(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.duties
    WHERE event_id = _event_id
      AND assigned_to = _user_id
      AND name = 'Subs Manager'
  );
$$;

-- Replace insert/update/delete policies to also allow Subs Manager for the linked event
DROP POLICY IF EXISTS "Admins and coaches can save game results" ON public.game_results;
CREATE POLICY "Admins, coaches and subs manager can save game results"
ON public.game_results FOR INSERT
WITH CHECK (
  saved_by = auth.uid() AND (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.team_id = game_results.team_id
        AND user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])
    )
    OR (game_results.event_id IS NOT NULL AND public.is_subs_manager_for_event(auth.uid(), game_results.event_id))
  )
);

DROP POLICY IF EXISTS "Admins and savers can update game results" ON public.game_results;
CREATE POLICY "Admins, savers and subs manager can update game results"
ON public.game_results FOR UPDATE
USING (
  saved_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.team_id = game_results.team_id
      AND user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])
  )
  OR (game_results.event_id IS NOT NULL AND public.is_subs_manager_for_event(auth.uid(), game_results.event_id))
);

DROP POLICY IF EXISTS "Admins and savers can delete game results" ON public.game_results;
CREATE POLICY "Admins and savers can delete game results"
ON public.game_results FOR DELETE
USING (
  saved_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.team_id = game_results.team_id
      AND user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])
  )
);
