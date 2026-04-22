
-- Fix defender chip positions in the new clearance frames so the
-- defender chip sits within ~6 pitch units of the clearance arrow's
-- start point (the contest-fairness rule's anchor heuristic).
-- We move the defender chip rather than the arrow so the visual story
-- (defender clearing the ball upfield) is preserved and the chip is
-- visibly the "actor" of the arrow.

UPDATE drill_frames
SET objects = (
  SELECT jsonb_agg(
    CASE WHEN o->>'id' = 'd2'
      THEN o || jsonb_build_object('x', 43, 'y', 53)
      ELSE o
    END
  )
  FROM jsonb_array_elements(objects) o
)
WHERE drill_id = 'f490eb3a-5454-488c-8157-9272b73891fe' AND position = 6;

UPDATE drill_frames
SET objects = (
  SELECT jsonb_agg(
    CASE WHEN o->>'id' = 'd1'
      THEN o || jsonb_build_object('x', 30, 'y', 42)
      ELSE o
    END
  )
  FROM jsonb_array_elements(objects) o
)
WHERE drill_id = 'bc5ca411-17f4-45c0-928f-b10efebb628f' AND position = 6;

UPDATE drill_frames
SET objects = (
  SELECT jsonb_agg(
    CASE WHEN o->>'id' = 'd1'
      THEN o || jsonb_build_object('x', 41, 'y', 50)
      ELSE o
    END
  )
  FROM jsonb_array_elements(objects) o
)
WHERE drill_id = '09c0af18-90d4-4225-960a-fe431898ad84' AND position = 6;
