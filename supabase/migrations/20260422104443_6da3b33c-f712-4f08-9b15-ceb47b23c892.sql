-- Pull waiting players + waiting label safely inside the pitch so they
-- never get clipped by the pitch boundary or playback toolbar overlay.

DO $$
DECLARE
  f_rec     RECORD;
  new_objs  jsonb;
  new_anns  jsonb;
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
      IF obj->>'id' LIKE 'w%' AND obj->>'type' = 'player' THEN
        nx := (obj->>'x')::numeric;
        ny := (obj->>'y')::numeric;
        IF ny >= 94 THEN ny := 90; END IF;
        IF ny <= 6  THEN ny := 10; END IF;
        IF nx >= 94 THEN nx := 90; END IF;
        IF nx <= 6  THEN nx := 10; END IF;
        obj := jsonb_set(jsonb_set(obj, '{x}', to_jsonb(nx)), '{y}', to_jsonb(ny));
      END IF;
      rebuilt_o := rebuilt_o || jsonb_build_array(obj);
    END LOOP;

    rebuilt_a := '[]'::jsonb;
    FOR ann IN SELECT * FROM jsonb_array_elements(f_rec.annotations)
    LOOP
      IF ann->>'id' = 'wait-label' THEN
        nx := (ann->'geometry'->>'x')::numeric;
        ny := (ann->'geometry'->>'y')::numeric;
        IF ny >= 88 THEN ny := 84; END IF;
        IF ny <= 12 THEN ny := 16; END IF;
        IF nx >= 88 THEN nx := 84; END IF;
        IF nx <= 12 THEN nx := 16; END IF;
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