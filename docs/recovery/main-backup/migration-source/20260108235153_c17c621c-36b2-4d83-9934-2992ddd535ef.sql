-- Make photos bucket private (if it's currently public)
UPDATE storage.buckets SET public = false WHERE id = 'photos';

-- Drop and recreate policies to ensure correct configuration
DROP POLICY IF EXISTS "Authenticated users can access photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete photos" ON storage.objects;

-- Create policy: Only authenticated users can access photos via the API
CREATE POLICY "Authenticated users can access photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'photos' AND auth.role() = 'authenticated');

-- Upload policy
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'photos' AND auth.role() = 'authenticated');

-- Update policy
CREATE POLICY "Users can update photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'photos' AND auth.role() = 'authenticated');

-- Delete policy
CREATE POLICY "Users can delete photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'photos' AND auth.role() = 'authenticated');

-- Add email_hash column to profiles for secure lookups
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_hash TEXT;

-- Create index for fast lookups by email_hash
CREATE INDEX IF NOT EXISTS idx_profiles_email_hash ON public.profiles(email_hash);

-- Create or replace function to hash email addresses (using SHA-256)
CREATE OR REPLACE FUNCTION public.hash_email(email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN encode(digest(lower(trim(email)), 'sha256'), 'hex');
END;
$$;