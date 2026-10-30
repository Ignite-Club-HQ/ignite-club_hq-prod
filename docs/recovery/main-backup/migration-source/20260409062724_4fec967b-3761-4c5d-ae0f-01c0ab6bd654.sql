
-- Merge duplicate children: keep the first record, link the second parent as guardian, remove duplicate
-- For each pair: child_to_keep (first), child_to_remove (second), parent_to_add (parent of child_to_remove)

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Find all duplicate children on the same team
  FOR rec IN
    WITH dupes AS (
      SELECT 
        c.name,
        cta.team_id,
        array_agg(c.id ORDER BY c.created_at) as child_ids,
        array_agg(c.parent_id ORDER BY c.created_at) as parent_ids
      FROM children c
      JOIN child_team_assignments cta ON cta.child_id = c.id
      GROUP BY c.name, cta.team_id
      HAVING COUNT(*) > 1
    )
    SELECT 
      name,
      team_id,
      child_ids[1] as keep_id,
      child_ids[2] as remove_id,
      parent_ids[1] as keep_parent,
      parent_ids[2] as add_parent
    FROM dupes
  LOOP
    -- 1. Add the second parent as a guardian of the kept child (if not already)
    INSERT INTO child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (rec.keep_id, rec.add_parent, 'parent', false)
    ON CONFLICT DO NOTHING;

    -- Also ensure the original parent is in guardians
    INSERT INTO child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (rec.keep_id, rec.keep_parent, 'parent', true)
    ON CONFLICT DO NOTHING;

    -- 2. Move any class_attendance from duplicate to kept child
    UPDATE class_attendance SET child_id = rec.keep_id WHERE child_id = rec.remove_id;

    -- 3. Move any class_enrolments from duplicate to kept child
    UPDATE class_enrolments SET child_id = rec.keep_id WHERE child_id = rec.remove_id;

    -- 4. Move any child_mini_league_assignments
    UPDATE child_mini_league_assignments SET child_id = rec.keep_id WHERE child_id = rec.remove_id;

    -- 5. Move any game_player_stats
    UPDATE game_player_stats SET child_id = rec.keep_id WHERE child_id = rec.remove_id;

    -- 6. Remove duplicate's team assignment
    DELETE FROM child_team_assignments WHERE child_id = rec.remove_id;

    -- 7. Remove any guardians of the duplicate child
    DELETE FROM child_guardians WHERE child_id = rec.remove_id;

    -- 8. Delete the duplicate child record
    DELETE FROM children WHERE id = rec.remove_id;

    RAISE NOTICE 'Merged child % into % (name: %)', rec.remove_id, rec.keep_id, rec.name;
  END LOOP;
END $$;
