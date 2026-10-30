-- Audience of a competition: everyone on accepted entered teams (+ parents/guardians of their junior players)
CREATE OR REPLACE FUNCTION public.competition_event_audience(_competition_id uuid)
RETURNS TABLE(user_id uuid, club_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH et AS (
    SELECT DISTINCT t.id AS team_id, t.club_id
    FROM public.competition_entries ce
    JOIN public.teams t ON t.id = ce.team_id
    WHERE ce.competition_id = _competition_id AND ce.status = 'accepted'
      AND t.deleted_at IS NULL AND t.club_id IS NOT NULL
  )
  SELECT DISTINCT ON (x.user_id) x.user_id, x.club_id FROM (
    SELECT ur.user_id, et.club_id FROM public.user_roles ur JOIN et ON ur.team_id = et.team_id
    UNION
    SELECT c.parent_id, et.club_id FROM public.child_team_assignments cta
      JOIN et ON cta.team_id = et.team_id JOIN public.children c ON c.id = cta.child_id
      WHERE c.parent_id IS NOT NULL
    UNION
    SELECT g.guardian_id, et.club_id FROM public.child_team_assignments cta
      JOIN et ON cta.team_id = et.team_id JOIN public.child_guardians g ON g.child_id = cta.child_id
      WHERE public.is_guardian_visible_in_club(g.guardian_id, et.club_id)
  ) x WHERE x.user_id IS NOT NULL
  ORDER BY x.user_id, x.club_id;
$$;
REVOKE EXECUTE ON FUNCTION public.competition_event_audience(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_view_competition_wide_event(_user_id uuid, _event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _event_id AND e.competition_id IS NOT NULL AND e.team_id IS NULL
      AND (
        public.has_role(_user_id, 'app_admin'::app_role, NULL::uuid, NULL::uuid)
        OR public.can_create_competition_event(_user_id, e.competition_id)
        OR EXISTS (SELECT 1 FROM public.competition_event_audience(e.competition_id) a WHERE a.user_id = _user_id)
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_view_competition_wide_event(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_competition_wide_event(uuid, uuid) TO authenticated;

-- Competition-wide events: visible only to the competition audience/organisers (not the whole organiser club)
CREATE POLICY "Competition-wide events limited to competition audience"
ON public.events AS RESTRICTIVE FOR SELECT TO authenticated
USING (competition_id IS NULL OR team_id IS NOT NULL
       OR public.can_view_competition_wide_event((SELECT auth.uid()), id));

CREATE POLICY "Competition audience can view competition-wide events"
ON public.events FOR SELECT TO authenticated
USING (competition_id IS NOT NULL AND team_id IS NULL
       AND public.can_view_competition_wide_event((SELECT auth.uid()), id));

CREATE POLICY "Competition audience can view competition-wide RSVPs"
ON public.rsvps FOR SELECT TO authenticated
USING (public.can_view_competition_wide_event((SELECT auth.uid()), event_id));

-- Recipient list for "resend invites" (organisers only)
CREATE OR REPLACE FUNCTION public.get_competition_event_recipients(p_event_id uuid)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_comp uuid;
BEGIN
  SELECT competition_id INTO v_comp FROM public.events WHERE id = p_event_id AND team_id IS NULL;
  IF v_comp IS NULL OR NOT public.can_create_competition_event(auth.uid(), v_comp) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.user_id FROM public.competition_event_audience(v_comp) a;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_competition_event_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competition_event_recipients(uuid) TO authenticated;

-- One shared competition event (no team copies); invites go to the competition audience only
CREATE OR REPLACE FUNCTION public.create_competition_event(p_competition_id uuid, p_title text, p_type event_type, p_event_date timestamp with time zone, p_location text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_club uuid;
  v_event uuid;
  v_count integer := 0;
  v_when text;
BEGIN
  IF v_uid IS NULL OR NOT public.can_create_competition_event(v_uid, p_competition_id) THEN
    RAISE EXCEPTION 'Not allowed to create events for this competition' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF p_event_date IS NULL THEN RAISE EXCEPTION 'Date and time are required'; END IF;

  SELECT organizer_club_id INTO v_club FROM public.competitions WHERE id = p_competition_id;
  IF v_club IS NULL THEN RAISE EXCEPTION 'Competition has no organising club'; END IF;

  INSERT INTO public.events (club_id, team_id, title, description, event_date, end_time,
                             location, location_name, type, created_by, competition_id,
                             reminder_hours_before, notify_suppressed)
  VALUES (v_club, NULL, btrim(p_title), NULLIF(btrim(COALESCE(p_description,'')),''),
          p_event_date, p_end_time,
          NULLIF(btrim(COALESCE(p_location,'')),''),
          NULLIF(split_part(btrim(COALESCE(p_location,'')), ',', 1),''),
          p_type, v_uid, p_competition_id, 24, true)
  RETURNING id INTO v_event;

  IF p_event_date > now() THEN
    v_when := to_char(p_event_date AT TIME ZONE 'Australia/Adelaide', 'Dy DD Mon, FMHH12:MI AM');
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
    SELECT a.user_id, 'event_invite', '📅 New event: ' || btrim(p_title) || ' — ' || v_when, v_event, a.club_id
    FROM public.competition_event_audience(p_competition_id) a
    WHERE a.user_id <> v_uid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN v_count;
END;
$function$;