-- Final cleanup: pull goals and edge text labels safely inside the pitch.

DO $$
DECLARE
  f_rec     RECORD;
  obj       jsonb;
  ann       jsonb;
  rebuilt_o jsonb;
  rebuilt_a jsonb;
  ny        numeric;
  nx        numeric;
BEGIN
  FOR f_rec IN
    SELECT f.id, f.objects, f.annotations
    FROM public.drill_frames f
    JOIN public.drills d ON d.id = f.drill_id
    WHERE d.is_official = true
  LOOP
    rebuilt_o := '[]'::jsonb;
    FOR obj IN SELECT * FROM jsonb_array_elements(f_rec.objects)
    LOOP
      IF obj->>'type' IN ('mini-goal', 'full-goal') THEN
        ny := (obj->>'y')::numeric;
        IF ny >= 91 THEN ny := 90; END IF;
        IF ny <= 9  THEN ny := 10; END IF;
        obj := jsonb_set(obj, '{y}', to_jsonb(ny));
      END IF;
      rebuilt_o := rebuilt_o || jsonb_build_array(obj);
    END LOOP;

    rebuilt_a := '[]'::jsonb;
    FOR ann IN SELECT * FROM jsonb_array_elements(f_rec.annotations)
    LOOP
      IF ann->>'type' = 'text' AND ann->'geometry' ? 'x' THEN
        nx := (ann->'geometry'->>'x')::numeric;
        ny := (ann->'geometry'->>'y')::numeric;
        IF ny >= 93 THEN ny := 90; END IF;
        IF ny <= 7  THEN ny := 10; END IF;
        IF nx >= 93 THEN nx := 90; END IF;
        IF nx <= 7  THEN nx := 10; END IF;
        ann := jsonb_set(
                 jsonb_set(ann, '{geometry,x}', to_jsonb(nx)),
                 '{geometry,y}', to_jsonb(ny)
               );
      END IF;
      rebuilt_a := rebuilt_a || jsonb_build_array(ann);
    END LOOP;

    UPDATE public.drill_frames
       SET objects = rebuilt_o,
           annotations = rebuilt_a,
           updated_at = now()
     WHERE id = f_rec.id;
  END LOOP;
END $$;