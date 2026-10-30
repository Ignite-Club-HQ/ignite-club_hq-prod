
-- H3: Remove blanket anonymous SELECT policies on public image buckets.
-- Buckets remain public=true so /object/public/<path> URLs continue to work
-- (that path bypasses RLS). This only stops anon listing/enumeration of objects.

DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view ad images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view sponsor logos" ON storage.objects;
DROP POLICY IF EXISTS "Club logos are publicly accessible" ON storage.objects;

-- Preserve authenticated read on club-logos so signed-in Storage API list/read calls work.
CREATE POLICY "Authenticated users can view club logos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'club-logos');

-- Authenticated read on sponsor-logos (matches upload/delete policies already in place).
CREATE POLICY "Authenticated users can view sponsor logos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'sponsor-logos');

-- app-ads: only app admins need list access; public URLs still serve images.
CREATE POLICY "App admins can view ad images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'app-ads'
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'app_admin'
  )
);
