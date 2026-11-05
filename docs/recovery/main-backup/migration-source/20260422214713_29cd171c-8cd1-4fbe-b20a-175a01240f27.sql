
-- Append rotation frames for drills with W chips that have NEVER been
-- promoted. Allow the "lead active chip" to be ANY non-muted player on the
-- pitch (including a previously-rotated W chip), so multi-cycle drills like
-- Cone slalom dribble and Dribble gates fully cover their waiting line.
DO $$
DECLARE
  drill_rec RECORD;
  last_frame RECORD;
  base_objs jsonb;
  new_objs jsonb;
  obj jsonb;
  lead_color text;
  lead_label text;
  lead_x numeric;
  lead_y numeric;
  lead_id text;
  promoted_w text[];
  all_w text[];
  next_w text;
  next_pos int;
  bench_xs numeric[];
  bench_count int;
  bench_index int;
  i int;
  rebuilt jsonb;
BEGIN
  FOR drill_rec IN
    SELECT DISTINCT d.id, d.name
    FROM drills d
    WHERE d.is_official
  LOOP
    -- All W chips defined in this drill (from frame 0)
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

    -- W chips already promoted at any point
    SELECT COALESCE(array_agg(DISTINCT o->>'id'), ARRAY[]::text[])
      INTO promoted_w
    FROM drill_frames df,
         jsonb_array_elements(df.objects) o
    WHERE df.drill_id = drill_rec.id
      AND o->>'type' = 'player'
      AND (o->>'id') ~ '^w[0-9]+$'
      AND lower(o->>'color') <> '#94a3b8';

    FOREACH next_w IN ARRAY all_w LOOP
      IF next_w = ANY(promoted_w) THEN
        CONTINUE;
      END IF;

      -- Re-read the latest frame each iteration (positions grow as we append)
      SELECT df.position, df.objects, df.duration_ms
        INTO last_frame
      FROM drill_frames df
      WHERE df.drill_id = drill_rec.id
      ORDER BY df.position DESC
      LIMIT 1;

      base_objs := last_frame.objects;
      next_pos := last_frame.position + 1;

      -- Find ANY currently-active player chip (any id, non-muted, on pitch)
      lead_id := NULL;
      FOR obj IN SELECT * FROM jsonb_array_elements(base_objs) LOOP
        IF obj->>'type' = 'player'
           AND lower(obj->>'color') <> '#94a3b8'
           AND (obj->>'y')::numeric < 88
           AND (obj->>'id') <> next_w THEN
          lead_id := obj->>'id';
          lead_color := obj->>'color';
          lead_label := obj->>'label';
          lead_x := (obj->>'x')::numeric;
          lead_y := (obj->>'y')::numeric;
          EXIT; -- take the first match
        END IF;
      END LOOP;

      IF lead_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Build new frame: bench the lead, promote next_w into its slot
      new_objs := '[]'::jsonb;
      FOR obj IN SELECT * FROM jsonb_array_elements(base_objs) LOOP
        IF (obj->>'id') = lead_id THEN
          obj := obj
            || jsonb_build_object('color', '#94a3b8', 'x', 90::numeric, 'y', 92::numeric);
        ELSIF (obj->>'id') = next_w THEN
          obj := obj
            || jsonb_build_object(
                 'color', lead_color,
                 'label', lead_label,
                 'x', lead_x,
                 'y', lead_y
               );
        END IF;
        new_objs := new_objs || jsonb_build_array(obj);
      END LOOP;

      -- Re-space all benched player chips along the bottom strip
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

      rebuilt := '[]'::jsonb;
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

      INSERT INTO drill_frames (drill_id, position, duration_ms, objects, annotations, notes)
      VALUES (drill_rec.id, next_pos, COALESCE(last_frame.duration_ms, 1500), new_objs, '[]'::jsonb, NULL);

      promoted_w := promoted_w || next_w;
    END LOOP;
  END LOOP;
END $$;
