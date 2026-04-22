
-- Move waiting / benched player chips from the right-edge column (x=90)
-- to a horizontal strip along the bottom edge (y=92) for the slalom +
-- gates drills. Active chips on the pitch are left untouched.
DO $$
DECLARE
  rec RECORD;
  obj jsonb;
  new_objects jsonb;
  bench_xs numeric[];
  bench_count int;
  bench_index int;
  i int;
BEGIN
  FOR rec IN
    SELECT df.id, df.objects, d.name
    FROM drill_frames df
    JOIN drills d ON d.id = df.drill_id
    WHERE d.is_official
      AND d.name IN (
        'Cone slalom dribble',
        'Dribble gates',
        'Outside-foot slalom'
      )
  LOOP
    -- Count chips that need repositioning (player chips currently parked at x=90)
    bench_count := 0;
    FOR obj IN SELECT * FROM jsonb_array_elements(rec.objects)
    LOOP
      IF obj->>'type' = 'player' AND (obj->>'x')::numeric = 90 THEN
        bench_count := bench_count + 1;
      END IF;
    END LOOP;

    IF bench_count = 0 THEN
      CONTINUE;
    END IF;

    -- Build evenly-spaced x positions across the bottom (12..88)
    bench_xs := ARRAY[]::numeric[];
    IF bench_count = 1 THEN
      bench_xs := ARRAY[50];
    ELSE
      FOR i IN 0..bench_count - 1 LOOP
        bench_xs := bench_xs || (12 + (i::numeric * (76 / (bench_count - 1)::numeric)));
      END LOOP;
    END IF;

    -- Rebuild the objects array, repositioning bench chips
    new_objects := '[]'::jsonb;
    bench_index := 0;
    FOR obj IN SELECT * FROM jsonb_array_elements(rec.objects)
    LOOP
      IF obj->>'type' = 'player' AND (obj->>'x')::numeric = 90 THEN
        bench_index := bench_index + 1;
        new_objects := new_objects || jsonb_build_array(
          obj
            || jsonb_build_object(
              'x', round(bench_xs[bench_index], 1),
              'y', 92
            )
        );
      ELSE
        new_objects := new_objects || jsonb_build_array(obj);
      END IF;
    END LOOP;

    UPDATE drill_frames
    SET objects = new_objects, updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END $$;
