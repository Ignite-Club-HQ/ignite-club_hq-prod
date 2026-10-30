
DO $$
DECLARE
  v_child_id uuid;
  v_maddie uuid := '0d3ceebd-3dcf-4d8d-bfae-d9cf02bcf36a';
  v_team uuid := '6a00b031-a627-4feb-bcd5-0d0daa551998';
  v_club uuid := '966bdaec-ebf1-46da-b2b3-cc53bf05c422';
  v_invite uuid := '7be6400b-e918-47f3-962b-26dcf4d33207';
BEGIN
  -- 1. Create child Ayla under Maddie
  INSERT INTO children (name, parent_id) VALUES ('Ayla', v_maddie) RETURNING id INTO v_child_id;

  -- 2. Assign to U7 Navy
  INSERT INTO child_team_assignments (child_id, team_id) VALUES (v_child_id, v_team)
    ON CONFLICT DO NOTHING;

  -- 3. Add Maddie as primary guardian
  INSERT INTO child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_child_id, v_maddie, 'parent', true)
    ON CONFLICT DO NOTHING;

  -- 4. Update Milos's pending invite metadata to reference new child id
  --    so when he accepts he is linked as co-guardian, not as a duplicate child.
  UPDATE pending_invites
  SET metadata = jsonb_set(
        metadata,
        '{children}',
        jsonb_build_array(
          jsonb_build_object(
            'existingChildId', v_child_id::text,
            'name', 'Ayla',
            'yearOfBirth', null,
            'jerseyNumber', null
          )
        )
      )
  WHERE id = v_invite;
END $$;
