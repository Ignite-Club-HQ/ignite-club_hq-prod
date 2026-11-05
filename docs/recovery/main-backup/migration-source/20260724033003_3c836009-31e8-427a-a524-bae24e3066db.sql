
CREATE OR REPLACE FUNCTION public.update_event_series(
  p_event_id uuid,
  p_updates jsonb,
  p_selected_event_date timestamptz,
  p_selected_start_time timestamptz,
  p_selected_end_time timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  ev_row public.events%ROWTYPE;
  parent_id uuid;
  allowed_columns text[] := ARRAY[
    'title','type','address','description','reminder_hours_before',
    'reminder_sent','amount','club_id','team_id','opponent',
    'arrival_minutes_before','rsvp_audience','is_bye','allow_guests',
    'max_guests_per_member','restricted_to_roles','adults_only'
  ];
  update_payload jsonb;
  can_edit boolean := false;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO ev_row FROM public.events WHERE id = p_event_id;
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
    RAISE EXCEPTION 'You do not have permission to update this series'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_object_agg(key, value)
    INTO update_payload
    FROM jsonb_each(COALESCE(p_updates, '{}'::jsonb))
   WHERE key = ANY(allowed_columns);

  IF update_payload IS NULL THEN
    update_payload := '{}'::jsonb;
  END IF;

  parent_id := COALESCE(ev_row.parent_event_id, ev_row.id);

  UPDATE public.events AS e
     SET
       title                   = COALESCE((update_payload->>'title')::text, e.title),
       type                    = COALESCE((update_payload->>'type')::public.event_type, e.type),
       address                 = CASE WHEN update_payload ? 'address' THEN NULLIF(update_payload->>'address','') ELSE e.address END,
       description             = CASE WHEN update_payload ? 'description' THEN NULLIF(update_payload->>'description','') ELSE e.description END,
       reminder_hours_before   = CASE WHEN update_payload ? 'reminder_hours_before' THEN NULLIF(update_payload->>'reminder_hours_before','')::int ELSE e.reminder_hours_before END,
       reminder_sent           = CASE WHEN update_payload ? 'reminder_sent' THEN (update_payload->>'reminder_sent')::boolean ELSE e.reminder_sent END,
       amount                  = CASE WHEN update_payload ? 'amount' THEN NULLIF(update_payload->>'amount','')::numeric ELSE e.amount END,
       club_id                 = COALESCE(NULLIF(update_payload->>'club_id','')::uuid, e.club_id),
       team_id                 = CASE WHEN update_payload ? 'team_id' THEN NULLIF(update_payload->>'team_id','')::uuid ELSE e.team_id END,
       opponent                = CASE WHEN update_payload ? 'opponent' THEN NULLIF(update_payload->>'opponent','') ELSE e.opponent END,
       arrival_minutes_before  = CASE WHEN update_payload ? 'arrival_minutes_before' THEN NULLIF(update_payload->>'arrival_minutes_before','')::int ELSE e.arrival_minutes_before END,
       rsvp_audience           = CASE WHEN update_payload ? 'rsvp_audience' THEN NULLIF(update_payload->>'rsvp_audience','') ELSE e.rsvp_audience END,
       is_bye                  = CASE WHEN update_payload ? 'is_bye' THEN (update_payload->>'is_bye')::boolean ELSE e.is_bye END,
       allow_guests            = CASE WHEN update_payload ? 'allow_guests' THEN (update_payload->>'allow_guests')::boolean ELSE e.allow_guests END,
       max_guests_per_member   = CASE WHEN update_payload ? 'max_guests_per_member' THEN NULLIF(update_payload->>'max_guests_per_member','')::int ELSE e.max_guests_per_member END,
       restricted_to_roles     = CASE WHEN update_payload ? 'restricted_to_roles' THEN
                                       CASE WHEN jsonb_typeof(update_payload->'restricted_to_roles') = 'array'
                                            THEN ARRAY(SELECT jsonb_array_elements_text(update_payload->'restricted_to_roles'))::public.app_role[]
                                            ELSE NULL END
                                     ELSE e.restricted_to_roles END,
       adults_only             = CASE WHEN update_payload ? 'adults_only' THEN (update_payload->>'adults_only')::boolean ELSE e.adults_only END,
       event_date              = COALESCE(p_selected_event_date, e.event_date),
       start_time              = COALESCE(p_selected_start_time, e.start_time),
       end_time                = COALESCE(p_selected_end_time, e.end_time)
   WHERE e.id = p_event_id;

  UPDATE public.events AS e
     SET
       title                   = COALESCE((update_payload->>'title')::text, e.title),
       type                    = COALESCE((update_payload->>'type')::public.event_type, e.type),
       address                 = CASE WHEN update_payload ? 'address' THEN NULLIF(update_payload->>'address','') ELSE e.address END,
       description             = CASE WHEN update_payload ? 'description' THEN NULLIF(update_payload->>'description','') ELSE e.description END,
       reminder_hours_before   = CASE WHEN update_payload ? 'reminder_hours_before' THEN NULLIF(update_payload->>'reminder_hours_before','')::int ELSE e.reminder_hours_before END,
       reminder_sent           = CASE WHEN update_payload ? 'reminder_sent' THEN (update_payload->>'reminder_sent')::boolean ELSE e.reminder_sent END,
       amount                  = CASE WHEN update_payload ? 'amount' THEN NULLIF(update_payload->>'amount','')::numeric ELSE e.amount END,
       club_id                 = COALESCE(NULLIF(update_payload->>'club_id','')::uuid, e.club_id),
       team_id                 = CASE WHEN update_payload ? 'team_id' THEN NULLIF(update_payload->>'team_id','')::uuid ELSE e.team_id END,
       opponent                = CASE WHEN update_payload ? 'opponent' THEN NULLIF(update_payload->>'opponent','') ELSE e.opponent END,
       arrival_minutes_before  = CASE WHEN update_payload ? 'arrival_minutes_before' THEN NULLIF(update_payload->>'arrival_minutes_before','')::int ELSE e.arrival_minutes_before END,
       rsvp_audience           = CASE WHEN update_payload ? 'rsvp_audience' THEN NULLIF(update_payload->>'rsvp_audience','') ELSE e.rsvp_audience END,
       is_bye                  = CASE WHEN update_payload ? 'is_bye' THEN (update_payload->>'is_bye')::boolean ELSE e.is_bye END,
       allow_guests            = CASE WHEN update_payload ? 'allow_guests' THEN (update_payload->>'allow_guests')::boolean ELSE e.allow_guests END,
       max_guests_per_member   = CASE WHEN update_payload ? 'max_guests_per_member' THEN NULLIF(update_payload->>'max_guests_per_member','')::int ELSE e.max_guests_per_member END,
       restricted_to_roles     = CASE WHEN update_payload ? 'restricted_to_roles' THEN
                                       CASE WHEN jsonb_typeof(update_payload->'restricted_to_roles') = 'array'
                                            THEN ARRAY(SELECT jsonb_array_elements_text(update_payload->'restricted_to_roles'))::public.app_role[]
                                            ELSE NULL END
                                     ELSE e.restricted_to_roles END,
       adults_only             = CASE WHEN update_payload ? 'adults_only' THEN (update_payload->>'adults_only')::boolean ELSE e.adults_only END
   WHERE (e.id = parent_id OR e.parent_event_id = parent_id)
     AND e.id <> p_event_id;
END;
$$;
