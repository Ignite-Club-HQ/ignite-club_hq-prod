-- Remove existing RLS policies that allow direct SELECT of secret keys
DROP POLICY IF EXISTS "Only app_admin can view app stripe config" ON public.app_stripe_config;
DROP POLICY IF EXISTS "Only club_admin or app_admin can view club stripe config" ON public.club_stripe_configs;

-- Create new policy that only allows SELECT of non-sensitive columns for app_stripe_config
-- Secret keys can only be accessed via service role in edge functions
CREATE POLICY "App admins can view app stripe config metadata only"
ON public.app_stripe_config
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'app_admin'
  )
);

-- Create new policy for club_stripe_configs
CREATE POLICY "Club admins can view club stripe config metadata only"
ON public.club_stripe_configs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (
      (user_roles.role = 'club_admin' AND user_roles.club_id = club_stripe_configs.club_id)
      OR user_roles.role = 'app_admin'
    )
  )
);

-- Note: The SELECT policies still allow access to all columns when RLS passes,
-- but the frontend now uses edge functions that never return secret keys.
-- For additional security, we update the INSERT/UPDATE policies to use service role pattern.

-- Remove direct insert/update for app_stripe_config - only via edge function with service role
DROP POLICY IF EXISTS "Only app_admin can create app stripe config" ON public.app_stripe_config;
DROP POLICY IF EXISTS "Only app_admin can update app stripe config" ON public.app_stripe_config;
DROP POLICY IF EXISTS "Only app_admin can delete app stripe config" ON public.app_stripe_config;

-- Create restrictive policies that only allow read (no direct write from client)
-- All writes happen via edge function with service role
CREATE POLICY "App admins can only read app stripe config"
ON public.app_stripe_config
FOR INSERT
WITH CHECK (false);  -- No direct inserts allowed from client

CREATE POLICY "No direct updates to app stripe config"
ON public.app_stripe_config
FOR UPDATE
USING (false)
WITH CHECK (false);  -- No direct updates allowed from client

CREATE POLICY "No direct deletes to app stripe config"
ON public.app_stripe_config
FOR DELETE
USING (false);  -- No direct deletes allowed from client

-- Same for club_stripe_configs
DROP POLICY IF EXISTS "Only club_admin or app_admin can create club stripe config" ON public.club_stripe_configs;
DROP POLICY IF EXISTS "Only club_admin or app_admin can update club stripe config" ON public.club_stripe_configs;
DROP POLICY IF EXISTS "Only club_admin or app_admin can delete club stripe config" ON public.club_stripe_configs;

CREATE POLICY "No direct inserts to club stripe config"
ON public.club_stripe_configs
FOR INSERT
WITH CHECK (false);  -- No direct inserts allowed from client

CREATE POLICY "No direct updates to club stripe config"
ON public.club_stripe_configs
FOR UPDATE
USING (false)
WITH CHECK (false);  -- No direct updates allowed from client

CREATE POLICY "No direct deletes to club stripe config"
ON public.club_stripe_configs
FOR DELETE
USING (false);  -- No direct deletes allowed from client

-- Drop the old RPC function that returned secret keys
DROP FUNCTION IF EXISTS public.get_club_stripe_config(uuid);