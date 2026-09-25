ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS player_welcome_message text,
  ADD COLUMN IF NOT EXISTS code_of_conduct_path text,
  ADD COLUMN IF NOT EXISTS code_of_conduct_name text;

CREATE POLICY "Competition admins read competition documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'competition-documents'
  AND public.is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));

CREATE POLICY "Competition admins upload competition documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'competition-documents'
  AND public.is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));

CREATE POLICY "Competition admins update competition documents"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'competition-documents'
  AND public.is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));

CREATE POLICY "Competition admins delete competition documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'competition-documents'
  AND public.is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));