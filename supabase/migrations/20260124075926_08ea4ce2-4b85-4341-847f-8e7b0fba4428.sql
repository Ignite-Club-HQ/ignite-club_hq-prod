-- Create a public storage bucket for club logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('club-logos', 'club-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for club-logos bucket
-- Allow anyone to view club logos (public)
CREATE POLICY "Club logos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'club-logos');

-- Allow authenticated users to upload club logos
CREATE POLICY "Authenticated users can upload club logos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'club-logos' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update their uploaded logos
CREATE POLICY "Authenticated users can update club logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'club-logos' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete club logos
CREATE POLICY "Authenticated users can delete club logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'club-logos' 
  AND auth.role() = 'authenticated'
);