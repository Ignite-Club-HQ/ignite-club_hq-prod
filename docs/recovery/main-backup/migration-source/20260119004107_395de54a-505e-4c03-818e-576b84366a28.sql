
-- Delete test group messages first (foreign key constraint)
DELETE FROM group_messages WHERE group_id IN (
  'ac3bc4d3-3aac-4aae-b525-e14d651ae88f',
  '5845ea8d-2704-494a-b6b7-820881c589f7',
  '0c02bbb2-dc53-4e1e-a2b2-0c239e44845f'
);

-- Delete test group members
DELETE FROM group_members WHERE group_id IN (
  'ac3bc4d3-3aac-4aae-b525-e14d651ae88f',
  '5845ea8d-2704-494a-b6b7-820881c589f7',
  '0c02bbb2-dc53-4e1e-a2b2-0c239e44845f'
);

-- Delete test chat groups
DELETE FROM chat_groups WHERE id IN (
  'ac3bc4d3-3aac-4aae-b525-e14d651ae88f',
  '5845ea8d-2704-494a-b6b7-820881c589f7',
  '0c02bbb2-dc53-4e1e-a2b2-0c239e44845f'
);
