INSERT INTO public.group_members (group_id, user_id, added_by)
SELECT cg.id, cg.created_by, cg.created_by
FROM public.chat_groups cg
WHERE cg.id = '7530abec-734f-4438-a900-b9d68fa5ab2c'
  AND cg.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = cg.id
      AND gm.user_id = cg.created_by
  );