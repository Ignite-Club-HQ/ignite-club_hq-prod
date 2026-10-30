-- Fix critical Stripe key exposure vulnerabilities
-- The existing policies use 'public' role which includes ALL users
-- We need to ensure only admins can access these tables

-- 1. Drop existing overly permissive policies on app_stripe_config
DROP POLICY IF EXISTS "App admins can manage stripe config" ON public.app_stripe_config;

-- Create restrictive policies for app_stripe_config
-- Only app_admin can SELECT (read) the config
CREATE POLICY "Only app_admin can view app stripe config"
ON public.app_stripe_config
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'app_admin'
  )
);

-- Only app_admin can INSERT
CREATE POLICY "Only app_admin can create app stripe config"
ON public.app_stripe_config
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'app_admin'
  )
);

-- Only app_admin can UPDATE
CREATE POLICY "Only app_admin can update app stripe config"
ON public.app_stripe_config
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'app_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'app_admin'
  )
);

-- Only app_admin can DELETE
CREATE POLICY "Only app_admin can delete app stripe config"
ON public.app_stripe_config
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'app_admin'
  )
);

-- 2. Drop existing overly permissive policies on club_stripe_configs
DROP POLICY IF EXISTS "Club admins can manage stripe configs" ON public.club_stripe_configs;

-- Create restrictive policies for club_stripe_configs
-- Only club_admin of the specific club OR app_admin can SELECT
CREATE POLICY "Only club_admin or app_admin can view club stripe config"
ON public.club_stripe_configs
FOR SELECT
TO authenticated
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

-- Only club_admin of the specific club OR app_admin can INSERT
CREATE POLICY "Only club_admin or app_admin can create club stripe config"
ON public.club_stripe_configs
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (
      (user_roles.role = 'club_admin' AND user_roles.club_id = club_stripe_configs.club_id)
      OR user_roles.role = 'app_admin'
    )
  )
);

-- Only club_admin of the specific club OR app_admin can UPDATE
CREATE POLICY "Only club_admin or app_admin can update club stripe config"
ON public.club_stripe_configs
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (
      (user_roles.role = 'club_admin' AND user_roles.club_id = club_stripe_configs.club_id)
      OR user_roles.role = 'app_admin'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (
      (user_roles.role = 'club_admin' AND user_roles.club_id = club_stripe_configs.club_id)
      OR user_roles.role = 'app_admin'
    )
  )
);

-- Only club_admin of the specific club OR app_admin can DELETE
CREATE POLICY "Only club_admin or app_admin can delete club stripe config"
ON public.club_stripe_configs
FOR DELETE
TO authenticated
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

-- 3. Deny anon access to both tables explicitly
CREATE POLICY "Deny anon access to app stripe config"
ON public.app_stripe_config
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "Deny anon access to club stripe configs"
ON public.club_stripe_configs
FOR ALL
TO anon
USING (false)
WITH CHECK (false);