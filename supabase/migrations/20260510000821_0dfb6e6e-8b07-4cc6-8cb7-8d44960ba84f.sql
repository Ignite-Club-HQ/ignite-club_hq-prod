CREATE OR REPLACE FUNCTION public.quick_rsvp_from_dm(_event_id uuid, _status text)
RETURNS TABLE(inserted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _team_id uuid;
  _inserted integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _status NOT IN ('going','maybe','not_going') THEN
    RAISE EXCEPTION 'Invalid status: %', _status;
  END IF;

  SELECT team_id INTO _team_id FROM public.events WHERE id = _event_id;
  IF _team_id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  -- Self RSVP (if user is on the team and hasn't responded yet)
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND team_id = _team_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.rsvps
    WHERE event_id = _event_id AND user_id = _uid AND child_id IS NULL
  )
  THEN
    INSERT INTO public.rsvps (event_id, user_id, child_id, status)
    VALUES (_event_id, _uid, NULL, _status::rsvp_status);
    _inserted := _inserted + 1;
  END IF;

  -- Each of the user's children assigned to this team without an RSVP
  WITH user_children AS (
    SELECT id FROM public.children WHERE parent_id = _uid
    UNION
    SELECT child_id AS id FROM public.child_guardians WHERE guardian_id = _uid
  ),
  team_kids AS (
    SELECT DISTINCT uc.id AS child_id
    FROM user_children uc
    JOIN public.child_team_assignments cta ON cta.child_id = uc.id
    WHERE cta.team_id = _team_id
  ),
  inserted AS (
    INSERT INTO public.rsvps (event_id, user_id, child_id, status)
    SELECT _event_id, _uid, tk.child_id, _status::rsvp_status
    FROM team_kids tk
    WHERE NOT EXISTS (
      SELECT 1 FROM public.rsvps r
      WHERE r.event_id = _event_id AND r.child_id = tk.child_id
    )
    RETURNING id
  )
  SELECT _inserted + COUNT(*)::int INTO _inserted FROM inserted;

  RETURN QUERY SELECT _inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_rsvp_from_dm(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.quick_rsvp_from_dm(uuid, text) TO authenticated;