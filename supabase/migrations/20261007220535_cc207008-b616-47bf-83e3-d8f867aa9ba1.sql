CREATE POLICY "Competition organisers can update competition-wide events"
ON public.events FOR UPDATE TO authenticated
USING (competition_id IS NOT NULL AND team_id IS NULL
       AND public.can_create_competition_event((SELECT auth.uid()), competition_id))
WITH CHECK (competition_id IS NOT NULL AND team_id IS NULL
       AND public.can_create_competition_event((SELECT auth.uid()), competition_id));

CREATE POLICY "Competition organisers can delete competition-wide events"
ON public.events FOR DELETE TO authenticated
USING (competition_id IS NOT NULL AND team_id IS NULL
       AND public.can_create_competition_event((SELECT auth.uid()), competition_id));

CREATE POLICY "Competition organisers can manage competition-wide RSVPs"
ON public.rsvps FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = rsvps.event_id AND e.competition_id IS NOT NULL AND e.team_id IS NULL
       AND public.can_create_competition_event((SELECT auth.uid()), e.competition_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = rsvps.event_id AND e.competition_id IS NOT NULL AND e.team_id IS NULL
       AND public.can_create_competition_event((SELECT auth.uid()), e.competition_id)));