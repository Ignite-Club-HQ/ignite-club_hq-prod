CREATE OR REPLACE FUNCTION public.convert_event_to_recurring_series(
  p_event_id uuid,
  p_parent_updates jsonb,
  p_child_events jsonb,
  p_parent_event_date timestamp with time zone,
  p_parent_start_time timestamp with time zone,
  p_parent_end_time timestamp with time zone,
  p_recurrence_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  ev_row public.events%ROWTYPE;
  allowed_columns text[] := ARRAY[
    'title','type','address','description','reminder_hours_before',
    'reminder_sent','amount','club_id','team_id','opponent',
    'arrival_minutes_before','rsvp_audience','is_bye','allow_guests',
    'max_guests_per_member','restricted_to_roles','adults_only',
    'rsvp_grouping','target_team_ids'
  ];
  p jsonb;
  can_edit boolean := false;
  child jsonb;
  child_date timestamptz;
  child_start timestamptz;
  child_end timestamptz;
  inserted_children int := 0;
  total_children int := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the parent row so two concurrent conversions cannot interleave.
  SELECT * INTO ev_row FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = caller AND role = 'app_admin') THEN
    can_edit := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = caller AND club_id = ev_row.club_id
      AND role IN ('club_admin','committee_member')
  ) THEN
    can_edit := true;
  ELSIF ev_row.team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = caller AND team_id = ev_row.team_id
      AND role IN ('team_admin','coach')
  ) THEN
    can_edit := true;
  ELSIF ev_row.mini_league_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.mini_league_admins
      WHERE user_id = caller AND mini_league_id = ev_row.mini_league_id
    ) OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = caller AND club_id = ev_row.club_id AND role = 'league_admin'
    )
  ) THEN
    can_edit := true;
  END IF;

  IF NOT can_edit THEN
    RAISE EXCEPTION 'You do not have permission to convert this event'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF ev_row.parent_event_id IS NOT NULL OR COALESCE(ev_row.is_recurring, false) THEN
    RAISE EXCEPTION 'This event is already part of a recurring series'
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT jsonb_object_agg(key, value)
    INTO p
    FROM jsonb_each(COALESCE(p_parent_updates, '{}'::jsonb))
   WHERE key = ANY(allowed_columns);
  IF p IS NULL THEN
    p := '{}'::jsonb;
  END IF;

  UPDATE public.events AS e
     SET
       title                   = COALESCE((p->>'title')::text, e.title),
       type                    = COALESCE((p->>'type')::public.event_type, e.type),
       address                 = CASE WHEN p ? 'address' THEN NULLIF(p->>'address','') ELSE e.address END,
       description             = CASE WHEN p ? 'description' THEN NULLIF(p->>'description','') ELSE e.description END,
       reminder_hours_before   = CASE WHEN p ? 'reminder_hours_before' THEN NULLIF(p->>'reminder_hours_before','')::int ELSE e.reminder_hours_before END,
       reminder_sent           = CASE WHEN p ? 'reminder_sent' THEN (p->>'reminder_sent')::boolean ELSE e.reminder_sent END,
       amount                  = CASE WHEN p ? 'amount' THEN NULLIF(p->>'amount','')::numeric ELSE e.amount END,
       club_id                 = COALESCE(NULLIF(p->>'club_id','')::uuid, e.club_id),
       team_id                 = CASE WHEN p ? 'team_id' THEN NULLIF(p->>'team_id','')::uuid ELSE e.team_id END,
       opponent                = CASE WHEN p ? 'opponent' THEN NULLIF(p->>'opponent','') ELSE e.opponent END,
       arrival_minutes_before  = CASE WHEN p ? 'arrival_minutes_before' THEN NULLIF(p->>'arrival_minutes_before','')::int ELSE e.arrival_minutes_before END,
       rsvp_audience           = CASE WHEN p ? 'rsvp_audience' THEN NULLIF(p->>'rsvp_audience','') ELSE e.rsvp_audience END,
       is_bye                  = CASE WHEN p ? 'is_bye' THEN (p->>'is_bye')::boolean ELSE e.is_bye END,
       allow_guests            = CASE WHEN p ? 'allow_guests' THEN (p->>'allow_guests')::boolean ELSE e.allow_guests END,
       max_guests_per_member   = CASE WHEN p ? 'max_guests_per_member' THEN NULLIF(p->>'max_guests_per_member','')::int ELSE e.max_guests_per_member END,
       restricted_to_roles     = CASE WHEN p ? 'restricted_to_roles' THEN
                                      CASE WHEN jsonb_typeof(p->'restricted_to_roles') = 'array'
                                           THEN ARRAY(SELECT jsonb_array_elements_text(p->'restricted_to_roles'))::public.app_role[]
                                           ELSE NULL END
                                    ELSE e.restricted_to_roles END,
       adults_only             = CASE WHEN p ? 'adults_only' THEN (p->>'adults_only')::boolean ELSE e.adults_only END,
       rsvp_grouping           = CASE WHEN p ? 'rsvp_grouping' THEN NULLIF(p->>'rsvp_grouping','') ELSE e.rsvp_grouping END,
       target_team_ids         = CASE WHEN p ? 'target_team_ids' THEN
                                      CASE WHEN jsonb_typeof(p->'target_team_ids') = 'array'
                                           THEN ARRAY(SELECT jsonb_array_elements_text(p->'target_team_ids'))::uuid[]
                                           ELSE NULL END
                                    ELSE e.target_team_ids END,
       event_date              = COALESCE(p_parent_event_date, e.event_date),
       start_time              = COALESCE(p_parent_start_time, e.start_time),
       end_time                = COALESCE(p_parent_end_time, e.end_time),
       is_recurring            = true,
       recurrence_end_date     = COALESCE(p_recurrence_end_date, e.recurrence_end_date)
   WHERE e.id = p_event_id;  -- promote-guard: allow

  -- Re-read the committed parent so children inherit authoritative scope.
  SELECT * INTO ev_row FROM public.events WHERE id = p_event_id;

  FOR child IN SELECT * FROM jsonb_array_elements(COALESCE(p_child_events, '[]'::jsonb)) LOOP
    child_date := NULLIF(child->>'event_date','')::timestamptz;
    IF child_date IS NULL THEN
      RAISE EXCEPTION 'Child occurrence is missing a date' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    child_start := COALESCE(NULLIF(child->>'start_time','')::timestamptz, child_date);
    child_end := NULLIF(child->>'end_time','')::timestamptz;
    total_children := total_children + 1;

    -- Idempotent retry: skip an occurrence that already exists for this parent.
    IF EXISTS (
      SELECT 1 FROM public.events
      WHERE parent_event_id = p_event_id AND event_date = child_date
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.events (
      title, type, address, description, reminder_hours_before, reminder_sent,
      amount, opponent, arrival_minutes_before, rsvp_audience, is_bye,
      allow_guests, max_guests_per_member, restricted_to_roles, adults_only,
      rsvp_grouping, target_team_ids,
      club_id, team_id, mini_league_id, parent_event_id, created_by,
      is_recurring, recurrence_end_date,
      event_date, start_time, end_time
    ) VALUES (
      ev_row.title, ev_row.type, ev_row.address, ev_row.description,
      ev_row.reminder_hours_before, false,
      ev_row.amount, ev_row.opponent, ev_row.arrival_minutes_before,
      ev_row.rsvp_audience, ev_row.is_bye,
      ev_row.allow_guests, ev_row.max_guests_per_member, ev_row.restricted_to_roles,
      ev_row.adults_only, ev_row.rsvp_grouping, ev_row.target_team_ids,
      ev_row.club_id, ev_row.team_id, ev_row.mini_league_id, p_event_id, caller,
      true, ev_row.recurrence_end_date,
      child_date, child_start, child_end
    );
    inserted_children := inserted_children + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'parent_event_id', p_event_id,
    'occurrence_count', total_children + 1,
    'children_created', inserted_children
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_event_to_recurring_series(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_event_to_recurring_series(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_event_to_recurring_series(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz, date) TO service_role;