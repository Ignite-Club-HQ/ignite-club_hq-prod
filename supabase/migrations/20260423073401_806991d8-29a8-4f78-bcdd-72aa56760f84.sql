DELETE FROM chat_groups
WHERE id IN ('c1111f11-3844-4c90-97c7-8a3bde1ca672', '0c4a4064-4b01-4beb-89a8-9ef849201a06', '4145673b-6d61-406d-b79f-356f58aad0ca')
  AND created_by = 'db6c8463-7b72-435a-a2a5-465d95c822e8'
  AND NOT EXISTS (SELECT 1 FROM group_messages WHERE group_id = chat_groups.id);