-- Fix the 12 built official drills: persist setup objects, re-inject vanished
-- players/balls, add missing movement arrows, refine grassroots language.

DO $$
DECLARE
  d_rec       RECORD;
  f_rec       RECORD;
  setup_objs  jsonb;
  prev_objs   jsonb;
  new_objs    jsonb;
  new_anns    jsonb;
  new_notes   text;
  obj         jsonb;
  pid         text;
  has_id      boolean;
  has_arrow   boolean;
  prev_p1     jsonb;
  this_p1     jsonb;
  arrow       jsonb;
BEGIN
  FOR d_rec IN
    SELECT id, name FROM public.drills
    WHERE is_official = true
      AND EXISTS (SELECT 1 FROM public.drill_frames f WHERE f.drill_id = drills.id)
    ORDER BY name
  LOOP
    -- Setup objects from frame 0: cones / mini-goal / full-goal
    SELECT COALESCE(
      jsonb_agg(o) FILTER (WHERE o->>'type' IN ('cone','mini-goal','full-goal')),
      '[]'::jsonb
    )
    INTO setup_objs
    FROM public.drill_frames f, jsonb_array_elements(f.objects) o
    WHERE f.drill_id = d_rec.id AND f.position = 0;

    prev_objs := NULL;

    FOR f_rec IN
      SELECT id, position, notes, objects, annotations
      FROM public.drill_frames
      WHERE drill_id = d_rec.id
      ORDER BY position
    LOOP
      new_objs  := COALESCE(f_rec.objects, '[]'::jsonb);
      new_anns  := COALESCE(f_rec.annotations, '[]'::jsonb);
      new_notes := f_rec.notes;

      IF f_rec.position > 0 THEN
        -- 1) Re-inject any setup obj missing in this frame
        FOR obj IN SELECT * FROM jsonb_array_elements(setup_objs)
        LOOP
          pid := obj->>'id';
          has_id := EXISTS (
            SELECT 1 FROM jsonb_array_elements(new_objs) x WHERE x->>'id' = pid
          );
          IF NOT has_id THEN
            new_objs := new_objs || jsonb_build_array(obj);
          END IF;
        END LOOP;

        -- 2) Re-inject players/balls present in prev frame but missing here
        IF prev_objs IS NOT NULL THEN
          FOR obj IN
            SELECT * FROM jsonb_array_elements(prev_objs) x
            WHERE x->>'type' IN ('player','ball')
          LOOP
            pid := obj->>'id';
            has_id := EXISTS (
              SELECT 1 FROM jsonb_array_elements(new_objs) y WHERE y->>'id' = pid
            );
            IF NOT has_id THEN
              new_objs := new_objs || jsonb_build_array(obj);
            END IF;
          END LOOP;
        END IF;

        -- 3) Add movement arrow if none exists and player p1 moved
        has_arrow := EXISTS (
          SELECT 1 FROM jsonb_array_elements(new_anns) a
          WHERE a->>'type' LIKE 'arrow%'
        );
        IF NOT has_arrow AND prev_objs IS NOT NULL THEN
          SELECT x INTO prev_p1
          FROM jsonb_array_elements(prev_objs) x
          WHERE x->>'id' = 'p1' AND x->>'type' = 'player'
          LIMIT 1;
          SELECT x INTO this_p1
          FROM jsonb_array_elements(new_objs) x
          WHERE x->>'id' = 'p1' AND x->>'type' = 'player'
          LIMIT 1;
          IF prev_p1 IS NOT NULL AND this_p1 IS NOT NULL THEN
            IF abs((prev_p1->>'x')::numeric - (this_p1->>'x')::numeric) >= 1
               OR abs((prev_p1->>'y')::numeric - (this_p1->>'y')::numeric) >= 1 THEN
              arrow := jsonb_build_object(
                'id', 'auto-move',
                'type', 'arrow-solid',
                'geometry', jsonb_build_object(
                  'from', jsonb_build_object('x', prev_p1->'x', 'y', prev_p1->'y'),
                  'to',   jsonb_build_object('x', this_p1->'x', 'y', this_p1->'y')
                ),
                'style', jsonb_build_object('color', '#fbbf24')
              );
              new_anns := new_anns || jsonb_build_array(arrow);
            END IF;
          END IF;
        END IF;
      END IF;

      -- 4) Refine grassroots language
      IF new_notes IS NOT NULL THEN
        new_notes := replace(new_notes, 'LEFT (weaker foot)', 'their weaker foot');
        new_notes := replace(new_notes, 'showing attacker to their LEFT', 'showing attacker onto their weaker foot');
        new_notes := replace(new_notes, 'drops shoulder LEFT', 'drops shoulder to weak side');
        new_notes := replace(new_notes, 'pushes ball RIGHT with outside foot', 'pushes ball to strong side with outside of foot');
        new_notes := replace(new_notes, 'pushes ball LEFT and accelerates', 'pushes ball into the gap and accelerates');
        new_notes := replace(new_notes, 'inside of the right foot', 'inside of foot');
        new_notes := replace(new_notes, 'outside of the right foot', 'outside of foot');
        new_notes := replace(new_notes, 'stepover to the right', 'stepover to one side');
      END IF;

      UPDATE public.drill_frames
         SET objects     = new_objs,
             annotations = new_anns,
             notes       = new_notes,
             updated_at  = now()
       WHERE id = f_rec.id;

      prev_objs := new_objs;
    END LOOP;
  END LOOP;
END $$;