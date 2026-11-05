-- ============================================================================
-- Phase 2 event scope enforcement
-- Diagnostic run before applying this migration:
--   * cross-club events (team_id.club_id <> event.club_id): 0 rows
--   * events pointing at a missing team:                      0 rows
-- Safe to enforce with no data remediation required.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_event_team_club_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  team_club uuid;
BEGIN
  -- Club-wide event (no team_id): always allowed.
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT club_id INTO team_club FROM public.teams WHERE id = NEW.team_id;

  IF team_club IS NULL THEN
    RAISE EXCEPTION
      'Event references a team that does not exist (team_id=%).', NEW.team_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF team_club <> NEW.club_id THEN
    RAISE EXCEPTION
      'Selected team does not belong to the selected club (team % is in club %, event uses club %).',
      NEW.team_id, team_club, NEW.club_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_event_team_club_scope() IS
  'Phase 2 (enforced): rejects events where team_id.club_id does not equal event.club_id. Fires after events_inherit_parent_scope so recurring children inherit before validation.';

-- Trigger already exists from Phase 1; leave binding as-is (BEFORE INSERT OR UPDATE OF team_id, club_id, parent_event_id).

-- ============================================================================
-- Transactional entire-series update
-- ============================================================================

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

  -- Permission check: app_admin OR club_admin/committee_member for the club
  --   OR team_admin/coach for the team OR mini_league admin (per-league or
  --   club-scoped league_admin role). Mirrors EditEventPage.canEdit gate.
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

  -- Whitelist columns from p_updates. Never allow the RPC to touch id,
  -- created_at, created_by, event_date, start_time, end_time, is_recurring,
  -- recurrence_end_date, parent_event_id, mini_league_id, or any column not
  -- explicitly listed above.
  SELECT jsonb_object_agg(key, value)
    INTO update_payload
    FROM jsonb_each(COALESCE(p_updates, '{}'::jsonb))
   WHERE key = ANY(allowed_columns);

  IF update_payload IS NULL THEN
    update_payload := '{}'::jsonb;
  END IF;

  -- Resolve the series parent id.
  parent_id := COALESCE(ev_row.parent_event_id, ev_row.id);

  -- 1) Update the selected event (with new date/time).
  UPDATE public.events AS e
     SET
       title                   = COALESCE((update_payload->>'title')::text, e.title),
       type                    = COALESCE((update_payload->>'type')::text, e.type),
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
                                            THEN ARRAY(SELECT jsonb_array_elements_text(update_payload->'restricted_to_roles'))
                                            ELSE NULL END
                                     ELSE e.restricted_to_roles END,
       adults_only             = CASE WHEN update_payload ? 'adults_only' THEN (update_payload->>'adults_only')::boolean ELSE e.adults_only END,
       event_date              = COALESCE(p_selected_event_date, e.event_date),
       start_time              = COALESCE(p_selected_start_time, e.start_time),
       end_time                = COALESCE(p_selected_end_time, e.end_time)
   WHERE e.id = p_event_id;

  -- 2) Update parent + all siblings, preserving each sibling's own event_date/start_time/end_time.
  UPDATE public.events AS e
     SET
       title                   = COALESCE((update_payload->>'title')::text, e.title),
       type                    = COALESCE((update_payload->>'type')::text, e.type),
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
                                            THEN ARRAY(SELECT jsonb_array_elements_text(update_payload->'restricted_to_roles'))
                                            ELSE NULL END
                                     ELSE e.restricted_to_roles END,
       adults_only             = CASE WHEN update_payload ? 'adults_only' THEN (update_payload->>'adults_only')::boolean ELSE e.adults_only END
   WHERE (e.id = parent_id OR e.parent_event_id = parent_id)
     AND e.id <> p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_event_series(uuid, jsonb, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_event_series(uuid, jsonb, timestamptz, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.update_event_series(uuid, jsonb, timestamptz, timestamptz, timestamptz) IS
  'Transactional entire-series edit: updates the selected event (with new date/time) plus its parent and siblings (preserving each sibling''s own date/time). Whitelists updatable columns. Verifies caller has app_admin, club_admin/committee_member, team_admin/coach, or mini-league admin permission before any write.';
