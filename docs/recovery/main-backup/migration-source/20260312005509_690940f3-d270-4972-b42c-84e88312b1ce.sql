-- Drop the public-facing SELECT policy
DROP POLICY IF EXISTS "Public can view visible sponsor profiles" ON public.business_profiles;

-- Recreate as authenticated-only
CREATE POLICY "Authenticated users can view visible sponsor profiles" ON public.business_profiles
FOR SELECT TO authenticated
USING (is_visible = true OR user_id = auth.uid());