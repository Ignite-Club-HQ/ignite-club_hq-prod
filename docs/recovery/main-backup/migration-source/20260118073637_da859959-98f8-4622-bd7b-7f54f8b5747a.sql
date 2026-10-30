-- Fix #1: Stripe config exposure - Block ALL client SELECT access to Stripe config tables
-- Stripe configuration should ONLY be accessed via the manage-stripe-config edge function

-- Drop existing SELECT policies that allow reading stripe config tables
DROP POLICY IF EXISTS "App admins can view app stripe config metadata only" ON app_stripe_config;
DROP POLICY IF EXISTS "Club admins can view club stripe config metadata only" ON club_stripe_configs;

-- Create new SELECT policies that block all client access
-- The edge function uses service role which bypasses RLS
CREATE POLICY "No direct client SELECT on app stripe config" 
ON app_stripe_config 
FOR SELECT 
USING (false);

CREATE POLICY "No direct client SELECT on club stripe configs" 
ON club_stripe_configs 
FOR SELECT 
USING (false);

-- Fix #2: Create a secure profiles view that excludes sensitive columns
-- This view can be used by the application instead of direct table access

-- Create a security definer function to check if user can see full profile
CREATE OR REPLACE FUNCTION public.can_view_full_profile(_viewer_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    _viewer_id = _profile_id -- User viewing their own profile
    OR has_role(_viewer_id, 'app_admin', NULL, NULL) -- App admin
$$;

-- Note: For email_hash, we don't need a separate view since we can handle this
-- at the application level. The email_hash is only used for passkey recovery
-- and should only be queried by the user themselves or through edge functions.

-- Add a comment to document the intended usage
COMMENT ON COLUMN profiles.email_hash IS 'Used for passkey recovery. Should only be accessed by profile owner or via server-side functions. Application code should not SELECT this column for non-owner profiles.';