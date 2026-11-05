CREATE POLICY "Managers can view event groups"
ON public.event_groups
FOR SELECT
TO authenticated
USING (public.can_manage_event_groups(auth.uid(), event_id));

CREATE POLICY "Managers can view event group players"
ON public.event_group_players
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.event_groups eg
    WHERE eg.id = event_group_players.group_id
      AND public.can_manage_event_groups(auth.uid(), eg.event_id)
  )
);

CREATE POLICY "Managers can view event group duties"
ON public.event_group_duties
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.event_groups eg
    WHERE eg.id = event_group_duties.group_id
      AND public.can_manage_event_groups(auth.uid(), eg.event_id)
  )
);