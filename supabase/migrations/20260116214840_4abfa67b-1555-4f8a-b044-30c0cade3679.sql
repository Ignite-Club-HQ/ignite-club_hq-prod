-- Create rate_limits table for tracking request counts
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identifier TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(identifier, endpoint)
);

-- Enable RLS
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table (edge functions use service role)
-- No policies for authenticated/anon users - they should not access this table directly

-- Create index for fast lookups
CREATE INDEX idx_rate_limits_identifier_endpoint ON public.rate_limits(identifier, endpoint);
CREATE INDEX idx_rate_limits_window_start ON public.rate_limits(window_start);

-- Function to clean up old rate limit entries (older than 1 hour)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limits 
  WHERE window_start < now() - INTERVAL '1 hour';
END;
$$;

-- Grant execute only to service_role
REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM authenticated;
REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;