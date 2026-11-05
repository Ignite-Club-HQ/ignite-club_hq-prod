DROP POLICY IF EXISTS "Admins can manage game summaries" ON public.game_summaries;
CREATE POLICY "Admins can manage game summaries"
ON public.game_summaries
FOR ALL
TO authenticated
USING (public.can_manage_team_roster(auth.uid(), team_id))
WITH CHECK (public.can_manage_team_roster(auth.uid(), team_id));

DROP POLICY IF EXISTS "Admins can manage game stats" ON public.game_player_stats;
CREATE POLICY "Admins can manage game stats"
ON public.game_player_stats
FOR ALL
TO authenticated
USING (public.can_manage_team_roster(auth.uid(), team_id))
WITH CHECK (public.can_manage_team_roster(auth.uid(), team_id));