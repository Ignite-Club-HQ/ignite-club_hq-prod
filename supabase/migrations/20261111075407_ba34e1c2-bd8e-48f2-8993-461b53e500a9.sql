DROP POLICY IF EXISTS competition_vault_writes_service_only ON storage.objects;

CREATE POLICY competition_vault_writes_managers_only ON storage.objects
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id <> 'competition-vault'
    OR (
      auth.uid() IS NOT NULL
      AND split_part(name, '/', 5) = auth.uid()::text
      AND split_part(name, '/', 6) <> ''
      AND split_part(name, '/', 7) = ''
      AND public.competition_vault_storage_access(name, true)
    )
  );

DROP POLICY IF EXISTS competition_vault_objects_insert_managers ON storage.objects;
CREATE POLICY competition_vault_objects_insert_managers ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'competition-vault'
    AND split_part(name, '/', 5) = auth.uid()::text
    AND split_part(name, '/', 6) <> ''
    AND split_part(name, '/', 7) = ''
    AND public.competition_vault_storage_access(name, true)
  );