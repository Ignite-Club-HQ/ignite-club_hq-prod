CREATE OR REPLACE FUNCTION public.create_event_with_duties(
  p_event jsonb,
  p_child_dates timestamptz[] DEFAULT NULL,
  p_duties jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  payload jsonb := (p_event - 'id' - 'created_at' - 'updated_at');
  cols text;
  child_cols text;
  child jsonb;
  d timestamptz;
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' OR NOT (payload ? 'event_date') THEN
    RAISE EXCEPTION 'event_date is required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(quote_ident(k), ', ')
  INTO cols
  FROM jsonb_object_keys(payload) AS k
  WHERE k IN (
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
  );

  IF cols IS NULL THEN
    RAISE EXCEPTION 'No valid event columns supplied' USING ERRCODE = 'check_violation';
  END IF;

  EXECUTE format(
    'INSERT INTO public.events (%s) SELECT %s FROM jsonb_populate_record(NULL::public.events, $1) RETURNING id',
    cols, cols
  ) INTO new_id USING payload;

  IF p_child_dates IS NOT NULL AND array_length(p_child_dates, 1) IS NOT NULL THEN
    child := payload || jsonb_build_object('parent_event_id', new_id);

    SELECT string_agg(quote_ident(k), ', ')
    INTO child_cols
    FROM jsonb_object_keys(child) AS k
    WHERE k IN (
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
    );

    FOREACH d IN ARRAY p_child_dates LOOP
      EXECUTE format(
        'INSERT INTO public.events (%s) SELECT %s FROM jsonb_populate_record(NULL::public.events, $1)',
        child_cols, child_cols
      ) USING (child || jsonb_build_object('event_date', d));
    END LOOP;
  END IF;

  IF p_duties IS NOT NULL AND jsonb_typeof(p_duties) = 'array' AND jsonb_array_length(p_duties) > 0 THEN
    INSERT INTO public.duties (event_id, name, assigned_to)
    SELECT new_id, e->>'name', NULLIF(e->>'assigned_to', '')::uuid
    FROM jsonb_array_elements(p_duties) AS e
    WHERE COALESCE(btrim(e->>'name'), '') <> '';
  END IF;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event_with_duties(jsonb, timestamptz[], jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_event_duties(
  p_event_id uuid,
  p_delete_ids uuid[] DEFAULT '{}'::uuid[],
  p_duties jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rec jsonb;
  result jsonb := '[]'::jsonb;
  new_id uuid;
  affected int;
  expected int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_delete_ids IS NOT NULL AND array_length(p_delete_ids, 1) IS NOT NULL THEN
    SELECT count(*) INTO expected
    FROM public.duties
    WHERE id = ANY(p_delete_ids) AND event_id = p_event_id;

    DELETE FROM public.duties
    WHERE id = ANY(p_delete_ids) AND event_id = p_event_id;
    GET DIAGNOSTICS affected = ROW_COUNT;

    IF affected < expected THEN
      RAISE EXCEPTION 'Not permitted to remove one or more duties'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_duties, '[]'::jsonb)) LOOP
    IF COALESCE(btrim(rec->>'name'), '') = '' THEN
      CONTINUE;
    END IF;

    IF NULLIF(rec->>'id', '') IS NOT NULL THEN
      UPDATE public.duties
      SET name = rec->>'name',
          assigned_to = NULLIF(rec->>'assigned_to', '')::uuid
      WHERE id = (rec->>'id')::uuid AND event_id = p_event_id;
      GET DIAGNOSTICS affected = ROW_COUNT;

      IF affected = 0 THEN
        RAISE EXCEPTION 'Not permitted to update duty %', rec->>'id'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      result := result || jsonb_build_object('idx', (rec->>'idx')::int, 'id', rec->>'id');
    ELSE
      INSERT INTO public.duties (event_id, name, assigned_to)
      VALUES (p_event_id, rec->>'name', NULLIF(rec->>'assigned_to', '')::uuid)
      RETURNING id INTO new_id;

      result := result || jsonb_build_object('idx', (rec->>'idx')::int, 'id', new_id);
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_event_duties(uuid, uuid[], jsonb) TO authenticated;