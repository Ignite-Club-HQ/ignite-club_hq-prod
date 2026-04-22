-- Add a "waiting line" of resting/queuing players to every built drill so
-- coaches can see what the rest of the squad is doing during each rep.

DO $$
DECLARE
  d_rec        RECORD;
  f_rec        RECORD;
  active_count int;
  waiting      int;
  required     int;
  i            int;
  wait_objs    jsonb;
  wait_label   jsonb;
  base_x       numeric;
  base_y       numeric;
  step_x       numeric;
  edge         text;        -- 'bottom' | 'top' | 'left' | 'right'
  px           numeric;
  py           numeric;
  has_wait     boolean;
  new_objs     jsonb;
  new_anns     jsonb;
BEGIN
  FOR d_rec IN
    SELECT id, name, COALESCE(players_required, 0) AS players_required
    FROM public.drills
    WHERE is_official = true
      AND EXISTS (SELECT 1 FROM public.drill_frames f WHERE f.drill_id = drills.id)
    ORDER BY name
  LOOP
    -- Count active players in the setup frame
    SELECT COUNT(*) INTO active_count
    FROM public.drill_frames f, jsonb_array_elements(f.objects) o
    WHERE f.drill_id = d_rec.id AND f.position = 0 AND o->>'type' = 'player';

    required := d_rec.players_required;
    waiting  := GREATEST(required - active_count, 0);

    -- Skip if everyone is already on (e.g., 4v4 SSG, Cool-down circle, dribble box)
    IF waiting <= 0 THEN
      CONTINUE;
    END IF;

    -- Pick a side based on drill type. Most attacking 1v1s start at bottom,
    -- so put the waiting line at the bottom edge. For drills already using
    -- bottom (slalom, gates) put it at the right edge.
    edge := CASE
      WHEN d_rec.name IN ('Cone slalom dribble','Dribble gates') THEN 'right'
      WHEN d_rec.name = 'Defensive shape walk-through'           THEN 'top'
      ELSE 'bottom'
    END;

    -- Build the waiting players array (muted slate color, labelled Wn)
    wait_objs := '[]'::jsonb;
    FOR i IN 1..waiting LOOP
      IF edge = 'bottom' THEN
        step_x := LEAST(8, 70.0 / GREATEST(waiting, 1));
        base_x := 50 - (step_x * (waiting - 1) / 2.0);
        px := base_x + step_x * (i - 1);
        py := 95;
      ELSIF edge = 'top' THEN
        step_x := LEAST(8, 70.0 / GREATEST(waiting, 1));
        base_x := 50 - (step_x * (waiting - 1) / 2.0);
        px := base_x + step_x * (i - 1);
        py := 5;
      ELSE -- 'right'
        px := 95;
        step_x := LEAST(8, 70.0 / GREATEST(waiting, 1));
        base_y := 50 - (step_x * (waiting - 1) / 2.0);
        py := base_y + step_x * (i - 1);
      END IF;

      wait_objs := wait_objs || jsonb_build_array(jsonb_build_object(
        'id',    'w' || i::text,
        'type',  'player',
        'x',     px,
        'y',     py,
        'label', 'W' || i::text,
        'color', '#94a3b8'
      ));
    END LOOP;

    -- Waiting-line text label
    IF edge = 'bottom' THEN
      wait_label := jsonb_build_object(
        'id',   'wait-label',
        'type', 'text',
        'geometry', jsonb_build_object('x', 50, 'y', 89, 'text', 'Waiting line — rotate in')
      );
    ELSIF edge = 'top' THEN
      wait_label := jsonb_build_object(
        'id',   'wait-label',
        'type', 'text',
        'geometry', jsonb_build_object('x', 50, 'y', 11, 'text', 'Waiting line — rotate in')
      );
    ELSE
      wait_label := jsonb_build_object(
        'id',   'wait-label',
        'type', 'text',
        'geometry', jsonb_build_object('x', 88, 'y', 50, 'text', 'Waiting')
      );
    END IF;

    -- Apply to every frame of the drill
    FOR f_rec IN
      SELECT id, objects, annotations
      FROM public.drill_frames
      WHERE drill_id = d_rec.id
      ORDER BY position
    LOOP
      new_objs := COALESCE(f_rec.objects, '[]'::jsonb);
      new_anns := COALESCE(f_rec.annotations, '[]'::jsonb);

      -- Append each waiting player only if not already present
      FOR i IN 1..waiting LOOP
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(new_objs) x
          WHERE x->>'id' = 'w' || i::text
        ) THEN
          new_objs := new_objs || jsonb_build_array(wait_objs->(i-1));
        END IF;
      END LOOP;

      -- Append the waiting-line label once per frame
      has_wait := EXISTS (
        SELECT 1 FROM jsonb_array_elements(new_anns) a
        WHERE a->>'id' = 'wait-label'
      );
      IF NOT has_wait THEN
        new_anns := new_anns || jsonb_build_array(wait_label);
      END IF;

      UPDATE public.drill_frames
         SET objects     = new_objs,
             annotations = new_anns,
             updated_at  = now()
       WHERE id = f_rec.id;
    END LOOP;
  END LOOP;
END $$;