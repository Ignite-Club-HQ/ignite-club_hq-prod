WITH dups AS (
  SELECT t.id AS dup_id,
         (SELECT v.id FROM public.vault_folders v
            WHERE v.chat_group_id = t.chat_group_id
              AND v.id <> t.id
              AND v.deleted_at IS NULL
            ORDER BY v.created_at ASC
            LIMIT 1) AS keep_id
  FROM public.vault_folders t
  WHERE t.created_at >= '2026-05-27 13:00:00+00'
    AND t.chat_group_id IS NOT NULL
)
UPDATE public.vault_files vf
   SET folder_id = d.keep_id
  FROM dups d
 WHERE vf.folder_id = d.dup_id
   AND d.keep_id IS NOT NULL;

UPDATE public.vault_folders
   SET restricted_roles = NULL,
       chat_group_id = NULL,
       deleted_at = now()
 WHERE id IN (
   SELECT t.id FROM public.vault_folders t
    WHERE t.created_at >= '2026-05-27 13:00:00+00'
      AND t.chat_group_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.vault_folders v
         WHERE v.chat_group_id = t.chat_group_id
           AND v.id <> t.id
           AND v.deleted_at IS NULL
      )
 );