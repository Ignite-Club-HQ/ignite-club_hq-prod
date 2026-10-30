-- Add RLS policy for rate_limits table (used by edge functions with service role)
-- This table should only be accessible by the service role for rate limiting operations

-- Policy for service role to manage rate limits
CREATE POLICY "Service role can manage rate limits"
ON public.rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Deny all access to authenticated users (rate limiting is handled server-side only)
CREATE POLICY "Deny authenticated user access to rate_limits"
ON public.rate_limits
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);