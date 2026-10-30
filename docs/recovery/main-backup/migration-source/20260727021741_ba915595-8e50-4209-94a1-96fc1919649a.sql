-- 1. Atomic association club-event fan-out ------------------------------------
CREATE OR REPLACE FUNCTION public.create_association_club_event_atomic(
  _caller_id uuid,
  _association_id uuid,
  _club_ids uuid[],
  _title text,
  _description text,
  _event_date timestamptz,
  _start_time timestamptz,
  _end_time timestamptz,
  _location_name text,
  _address text,
  _allow_guests boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent_id uuid;
  v_valid_clubs uuid[];
  v_child_ids uuid[];
BEGIN
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'caller required' USING ERRCODE = '28000';
  END IF;
  IF _title IS NULL OR btrim(_title) = '' OR _event_date IS NULL THEN
    RAISE EXCEPTION 'title and event_date required' USING ERRCODE = '22023';
  END IF;

  -- Defence in depth: association must exist and be an association
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = _association_id AND c.kind = 'association'
  ) THEN
    RAISE EXCEPTION 'association not found' USING ERRCODE = '22023';
  END IF;

  -- Defence in depth: caller must administer the association
  IF NOT public.is_club_admin(_caller_id, _association_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Deduplicate + restrict to clubs owned by this association
  SELECT array_agg(c.id)
    INTO v_valid_clubs
  FROM public.clubs c
  WHERE c.parent_org_id = _association_id
    AND c.id = ANY (COALESCE(_club_ids, ARRAY[]::uuid[]));

  IF v_valid_clubs IS NULL OR array_length(v_valid_clubs, 1) IS NULL THEN
    RAISE EXCEPTION 'no invited clubs belong to this association' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.events (
    title, description, event_date, start_time, end_time,
    location_name, address, type, created_by, association_id,
    allow_guests, club_id
  ) VALUES (
    _title, _description, _event_date, _start_time, _end_time,
    _location_name, _address, 'social', _caller_id, _association_id,
    COALESCE(_allow_guests, true), _association_id
  )
  RETURNING id INTO v_parent_id;

  WITH ins AS (
    INSERT INTO public.events (
      title, description, event_date, start_time, end_time,
      location_name, address, type, created_by, association_id,
      allow_guests, club_id, association_event_id
    )
    SELECT
      _title, _description, _event_date, _start_time, _end_time,
      _location_name, _address, 'social', _caller_id, _association_id,
      COALESCE(_allow_guests, true), cid, v_parent_id
    FROM unnest(v_valid_clubs) AS cid
    RETURNING id
  )
  SELECT array_agg(id) INTO v_child_ids FROM ins;

  RETURN jsonb_build_object(
    'parent_event_id', v_parent_id,
    'child_event_ids', to_jsonb(COALESCE(v_child_ids, ARRAY[]::uuid[])),
    'invited_clubs', array_length(v_valid_clubs, 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_association_club_event_atomic(
  uuid, uuid, uuid[], text, text, timestamptz, timestamptz, timestamptz, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_association_club_event_atomic(
  uuid, uuid, uuid[], text, text, timestamptz, timestamptz, timestamptz, text, text, boolean
) TO service_role;

-- 2. Per-object storage authorization ------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_storage_objects(
  _user_id uuid,
  _items jsonb
)
RETURNS TABLE (bucket text, path text, allowed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  seg text[];
  v_allowed boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT (i->>'bucket') AS b, (i->>'path') AS p
    FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) AS i
  LOOP
    v_allowed := false;
    seg := string_to_array(r.p, '/');

    IF r.b = 'chat-attachments' THEN
      IF seg[1] = 'general' THEN
        v_allowed := (seg[2] = _user_id::text);
      ELSIF seg[1] = 'clubs' THEN
        v_allowed := EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id
            AND ur.club_id::text = seg[2]
        );
      ELSE
        v_allowed := (seg[1] = _user_id::text);
      END IF;

    ELSIF r.b = 'photos' THEN
      v_allowed := EXISTS (
        SELECT 1 FROM public.photos ph
        WHERE (ph.image_url LIKE '%/photos/' || r.p OR ph.file_url LIKE '%/photos/' || r.p)
          AND ph.deleted_at IS NULL
          AND (
            (ph.team_id IS NOT NULL AND (
               public.is_team_member(_user_id, ph.team_id)
               OR public.has_role(_user_id, 'club_admin', ph.club_id, NULL)
               OR public.has_role(_user_id, 'app_admin', NULL, NULL)
            ))
            OR (ph.team_id IS NULL AND ph.mini_league_id IS NULL AND (
               public.is_club_member(_user_id, ph.club_id)
               OR public.has_role(_user_id, 'app_admin', NULL, NULL)
            ))
            OR (ph.mini_league_id IS NOT NULL AND (
               EXISTS (
                 SELECT 1 FROM public.user_roles ur
                 JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
                 WHERE ml.id = ph.mini_league_id
                   AND ur.user_id = _user_id
                   AND ur.role = ANY (ARRAY['league_admin','coach','club_admin','app_admin']::app_role[])
               )
               OR EXISTS (
                 SELECT 1 FROM public.mini_league_players mlp
                 WHERE mlp.mini_league_id = ph.mini_league_id
                   AND mlp.parent_user_id = _user_id
               )
            ))
            OR ph.uploader_id = _user_id
          )
      );

    ELSIF r.b = 'avatars' THEN
      -- Profile avatars are intentionally visible to every authenticated user.
      v_allowed := true;
    END IF;

    bucket := r.b;
    path := r.p;
    allowed := COALESCE(v_allowed, false);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_storage_objects(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_storage_objects(uuid, jsonb) TO service_role;