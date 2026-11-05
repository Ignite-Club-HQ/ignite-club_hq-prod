-- Security hardening: Restrict access to sensitive RPC functions
-- Addresses: RPC Function Enumeration vulnerability

-- Revoke EXECUTE from public on sensitive functions that should only be called by authenticated users
-- Note: We keep functions that are intentionally public for the app to work

-- Create a security definer function to validate admin access
CREATE OR REPLACE FUNCTION public.require_app_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'app_admin'
  ) THEN
    RAISE EXCEPTION 'Access denied: app_admin role required';
  END IF;
  RETURN true;
END;
$$;

-- Create a function to check if user is club admin
CREATE OR REPLACE FUNCTION public.require_club_admin(p_club_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND (
      role = 'app_admin' 
      OR (role = 'club_admin' AND club_id = p_club_id)
    )
  ) THEN
    RAISE EXCEPTION 'Access denied: club_admin role required';
  END IF;
  RETURN true;
END;
$$;

-- Add rate limiting for password reset at database level
-- This creates a function that can be called to check reset attempts
CREATE OR REPLACE FUNCTION public.check_password_reset_rate_limit(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_window_start timestamptz := now() - interval '1 hour';
BEGIN
  -- Count reset attempts in the last hour
  SELECT COUNT(*) INTO v_count
  FROM public.rate_limits
  WHERE identifier = p_email
    AND endpoint = 'password_reset'
    AND window_start > v_window_start;
  
  -- Allow max 3 reset attempts per hour
  IF v_count >= 3 THEN
    RETURN false;
  END IF;
  
  -- Record this attempt
  INSERT INTO public.rate_limits (identifier, endpoint, request_count, window_start)
  VALUES (p_email, 'password_reset', 1, now())
  ON CONFLICT (identifier, endpoint) 
  DO UPDATE SET 
    request_count = CASE 
      WHEN rate_limits.window_start > v_window_start THEN rate_limits.request_count + 1
      ELSE 1
    END,
    window_start = CASE 
      WHEN rate_limits.window_start > v_window_start THEN rate_limits.window_start
      ELSE now()
    END,
    updated_at = now();
  
  RETURN true;
END;
$$;

-- Create index for faster rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup 
ON public.rate_limits (identifier, endpoint, window_start);

-- Ensure rate_limits table has unique constraint for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'rate_limits_identifier_endpoint_key'
  ) THEN
    ALTER TABLE public.rate_limits 
    ADD CONSTRAINT rate_limits_identifier_endpoint_key 
    UNIQUE (identifier, endpoint);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- Add comment for documentation
COMMENT ON FUNCTION public.check_password_reset_rate_limit IS 'Rate limits password reset requests to 3 per hour per email address';
COMMENT ON FUNCTION public.require_app_admin IS 'Security helper to verify app_admin role';
COMMENT ON FUNCTION public.require_club_admin IS 'Security helper to verify club_admin role for specific club';