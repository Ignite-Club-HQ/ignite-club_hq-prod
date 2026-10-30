
-- For every official drill, ensure every "Wn" waiting chip eventually
-- gets promoted into the lead active role at least once. We do this by
-- cloning the most recent frame and swapping the named active chip ("p1")
-- with the next un-promoted W chip, then bench-spacing the rest.
DO $$
DECLARE
  drill_rec RECORD;
  last_frame RECORD;
  base_objs jsonb;
  new_objs jsonb;
  obj jsonb;
  active_color text;
  active_label text;
  active_x numeric;
  active_y numeric;
  active_id text;
  promoted_w text[];
  all_w text[];
  next_w text;
  next_pos int;
  bench_xs numeric[];
  bench_count int;
  bench_index int;
  i int;
BEGIN
  FOR drill_rec IN
    SELECT DISTINCT d.id, d.name
    FROM drills d
    WHERE d.is_official
  LOOP
    -- Collect all W chips that exist in this drill (from frame 0)
    SELECT array_agg(o->>'id' ORDER BY o->>'id')
      INTO all_w
    FROM drill_frames df,
         jsonb_array_elements(df.objects) o
    WHERE df.drill_id = drill_rec.id
      AND df.position = 0
      AND o->>'type' = 'player'
      AND (o->>'id') ~ '^w[0-9]+$';

    IF all_w IS NULL OR array_length(all_w, 1) IS NULL THEN
      CONTINUE;
    END IF;

    -- Collect every W chip that has been promoted (color != muted) in any frame
    SELECT COALESCE(array_agg(DISTINCT o->>'id'), ARRAY[]::text[])
      INTO promoted_w
    FROM drill_frames df,
         jsonb_array_elements(df.objects) o
    WHERE df.drill_id = drill_rec.id
      AND o->>'type' = 'player'
      AND (o->>'id') ~ '^w[0-9]+$'
      AND lower(o->>'color') <> '#94a3b8';

    -- Loop through W chips that have NEVER been promoted
    FOREACH next_w IN ARRAY all_w LOOP
      IF next_w = ANY(promoted_w) THEN
        CONTINUE;
      END IF;

      -- Re-read the current last frame (it changes as we append)
      SELECT df.position, df.objects, df.duration_ms
        INTO last_frame
      FROM drill_frames df
      WHERE df.drill_id = drill_rec.id
      ORDER BY df.position DESC
      LIMIT 1;

      base_objs := last_frame.objects;
      next_pos := last_frame.position + 1;

      -- Find the lead active chip (any non-W player chip currently on
      -- the pitch and not muted). Prefer "p1" if present; else first match.
      active_id := NULL;
      FOR obj IN SELECT * FROM jsonb_array_elements(base_objs) LOOP
        IF obj->>'type' = 'player'
           AND (obj->>'id') !~ '^w[0-9]+$'
           AND lower(obj->>'color') <> '#94a3b8'
           AND (obj->>'y')::numeric < 88 THEN
          IF active_id IS NULL OR (obj->>'id') = 'p1' THEN
            active_id := obj->>'id';
            active_color := obj->>'color';
            active_label := obj->>'label';
            active_x := (obj->>'x')::numeric;
            active_y := (obj->>'y')::numeric;
          END IF;
        END IF;
      END LOOP;

      IF active_id IS NULL THEN
        EXIT; -- nothing to swap with; stop
      END IF;

      -- Build the new frame: bench the active chip, promote the W chip
      new_objs := '[]'::jsonb;
      FOR obj IN SELECT * FROM jsonb_array_elements(base_objs) LOOP
        IF (obj->>'id') = active_id THEN
          obj := obj
            || jsonb_build_object('color', '#94a3b8', 'x', 90::numeric, 'y', 92::numeric);
        ELSIF (obj->>'id') = next_w THEN
          obj := obj
            || jsonb_build_object(
                 'color', active_color,
                 'label', active_label,
                 'x', active_x,
                 'y', active_y
               );
        END IF;
        new_objs := new_objs || jsonb_build_array(obj);
      END LOOP;

      -- Re-space ALL benched player chips along the bottom (y >= 88 OR x = 90 marker)
      bench_count := 0;
      FOR obj IN SELECT * FROM jsonb_array_elements(new_objs) LOOP
        IF obj->>'type' = 'player'
           AND ((obj->>'y')::numeric >= 88 OR (obj->>'x')::numeric = 90) THEN
          bench_count := bench_count + 1;
        END IF;
      END LOOP;

      bench_xs := ARRAY[]::numeric[];
      IF bench_count = 1 THEN
        bench_xs := ARRAY[50::numeric];
      ELSIF bench_count > 1 THEN
        FOR i IN 0..bench_count - 1 LOOP
          bench_xs := bench_xs || (12 + (i::numeric * (76 / (bench_count - 1)::numeric)));
        END LOOP;
      END IF;

      DECLARE
        rebuilt jsonb := '[]'::jsonb;
      BEGIN
        bench_index := 0;
        FOR obj IN SELECT * FROM jsonb_array_elements(new_objs) LOOP
          IF obj->>'type' = 'player'
             AND ((obj->>'y')::numeric >= 88 OR (obj->>'x')::numeric = 90) THEN
            bench_index := bench_index + 1;
            obj := obj || jsonb_build_object(
              'x', round(bench_xs[bench_index], 1),
              'y', 92::numeric
            );
          END IF;
          rebuilt := rebuilt || jsonb_build_array(obj);
        END LOOP;
        new_objs := rebuilt;
      END;

      -- Append the new rotation frame
      INSERT INTO drill_frames (drill_id, position, duration_ms, objects, annotations, notes)
      VALUES (drill_rec.id, next_pos, COALESCE(last_frame.duration_ms, 1500), new_objs, '[]'::jsonb, NULL);

      -- Mark this W as promoted so we don't re-run on the same drill
      promoted_w := promoted_w || next_w;
    END LOOP;
  END LOOP;
END $$;
