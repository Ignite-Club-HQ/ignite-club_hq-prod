-- Slow down the "pass + run-onto-ball + shoot" transitions in
-- "Driven shot from pass U9-U12" so attackers don't sprint through the strike.
-- Frame durations are applied to the SOURCE frame's transition, so we lengthen
-- the pass frames (positions 1, 4, 7) which feed into the shooting frames.
UPDATE public.drill_frames
SET duration_ms = 2800, updated_at = now()
WHERE drill_id = 'e4190a85-05cb-488f-a3cb-aa5263710224'
  AND position IN (1, 4, 7);