-- Remove the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Anyone can read admob config" ON public.admob_config;

-- The existing "Only app admins can view admob config" policy already restricts SELECT to authenticated app_admins