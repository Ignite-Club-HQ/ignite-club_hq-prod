
-- 1. Column
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS target_team_ids uuid[];

-- 2. Validation trigger
CREATE OR REPLACE FUNCTION public.validate_event_target_team_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad_count int;
BEGIN
  IF NEW.target_team_ids IS NULL OR array_length(NEW.target_team_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'target_team_ids can only be set on club-wide events (team_id must be null)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.type NOT IN ('game','social') THEN
    RAISE EXCEPTION 'target_team_ids is only supported for game or social events'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.club_id IS NULL THEN
    RAISE EXCEPTION 'target_team_ids requires a club_id'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO bad_count
  FROM unnest(NEW.target_team_ids) AS tid
  LEFT JOIN public.teams t ON t.id = tid
  WHERE t.id IS NULL OR t.club_id <> NEW.club_id;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'target_team_ids contains teams that do not belong to the event club'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_validate_target_team_ids ON public.events;
CREATE TRIGGER events_validate_target_team_ids
  BEFORE INSERT OR UPDATE OF target_team_ids, team_id, type, club_id ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_event_target_team_ids();

-- 3. Extend recurring scope inheritance
CREATE OR REPLACE FUNCTION public.inherit_parent_event_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent RECORD;
BEGIN
  IF NEW.parent_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT mini_league_id, team_id, club_id, restricted_to_roles, target_team_ids
  INTO parent
  FROM public.events
  WHERE id = NEW.parent_event_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.mini_league_id IS NULL AND parent.mini_league_id IS NOT NULL THEN
    NEW.mini_league_id := parent.mini_league_id;
  END IF;

  IF NEW.team_id IS NULL AND parent.team_id IS NOT NULL THEN
    NEW.team_id := parent.team_id;
  END IF;

  IF NEW.club_id IS NULL AND parent.club_id IS NOT NULL THEN
    NEW.club_id := parent.club_id;
  END IF;

  IF NEW.restricted_to_roles IS NULL AND parent.restricted_to_roles IS NOT NULL THEN
    NEW.restricted_to_roles := parent.restricted_to_roles;
  END IF;

  IF NEW.target_team_ids IS NULL AND parent.target_team_ids IS NOT NULL THEN
    NEW.target_team_ids := parent.target_team_ids;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Extend update_event_series whitelist + column updates
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
    'max_guests_per_member','restricted_to_roles','adults_only',
    'rsvp_grouping','target_team_ids'
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

  -- Selected event
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
       rsvp_grouping           = CASE WHEN update_payload ? 'rsvp_grouping' THEN NULLIF(update_payload->>'rsvp_grouping','') ELSE e.rsvp_grouping END,
       target_team_ids         = CASE WHEN update_payload ? 'target_team_ids' THEN
                                       CASE WHEN jsonb_typeof(update_payload->'target_team_ids') = 'array'
                                            THEN ARRAY(SELECT jsonb_array_elements_text(update_payload->'target_team_ids'))::uuid[]
                                            ELSE NULL END
                                     ELSE e.target_team_ids END,
       event_date              = COALESCE(p_selected_event_date, e.event_date),
       start_time              = COALESCE(p_selected_start_time, e.start_time),
       end_time                = COALESCE(p_selected_end_time, e.end_time)
   WHERE e.id = p_event_id;  -- promote-guard: allow

  -- Series siblings
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
       rsvp_grouping           = CASE WHEN update_payload ? 'rsvp_grouping' THEN NULLIF(update_payload->>'rsvp_grouping','') ELSE e.rsvp_grouping END,
       target_team_ids         = CASE WHEN update_payload ? 'target_team_ids' THEN
                                       CASE WHEN jsonb_typeof(update_payload->'target_team_ids') = 'array'
                                            THEN ARRAY(SELECT jsonb_array_elements_text(update_payload->'target_team_ids'))::uuid[]
                                            ELSE NULL END
                                     ELSE e.target_team_ids END
   WHERE (e.id = parent_id OR e.parent_event_id = parent_id)
     AND e.id <> p_event_id;  -- promote-guard: allow
END;
$$;
