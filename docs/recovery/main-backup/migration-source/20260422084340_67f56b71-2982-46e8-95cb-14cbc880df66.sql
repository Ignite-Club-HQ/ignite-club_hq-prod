-- Close-control dribble box: add a ball next to each of the 6 players in both frames.
-- Frame 0
UPDATE public.drill_frames
SET objects = objects || jsonb_build_array(
  jsonb_build_object('id','b1','type','ball','x',43,'y',40),
  jsonb_build_object('id','b2','type','ball','x',58,'y',42),
  jsonb_build_object('id','b3','type','ball','x',65,'y',58),
  jsonb_build_object('id','b4','type','ball','x',48,'y',62),
  jsonb_build_object('id','b5','type','ball','x',53,'y',50),
  jsonb_build_object('id','b6','type','ball','x',41,'y',52)
)
WHERE drill_id = '7b7deb74-8f6f-4a08-b1c0-695e1e921f11' AND position = 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(objects) o WHERE o->>'type' = 'ball'
  );

-- Frame 1
UPDATE public.drill_frames
SET objects = objects || jsonb_build_array(
  jsonb_build_object('id','b1','type','ball','x',58,'y',35),
  jsonb_build_object('id','b2','type','ball','x',68,'y',50),
  jsonb_build_object('id','b3','type','ball','x',53,'y',65),
  jsonb_build_object('id','b4','type','ball','x',38,'y',55),
  jsonb_build_object('id','b5','type','ball','x',48,'y',45),
  jsonb_build_object('id','b6','type','ball','x',53,'y',38)
)
WHERE drill_id = '7b7deb74-8f6f-4a08-b1c0-695e1e921f11' AND position = 1
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(objects) o WHERE o->>'type' = 'ball'
  );

-- Cool-down circle: add a single ball at the centre of the circle on both frames.
UPDATE public.drill_frames
SET objects = objects || jsonb_build_array(
  jsonb_build_object('id','b-centre','type','ball','x',50,'y',50)
)
WHERE drill_id = '82161da0-5fb3-46c9-826d-1e8ee3b350b2'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(objects) o WHERE o->>'type' = 'ball'
  );