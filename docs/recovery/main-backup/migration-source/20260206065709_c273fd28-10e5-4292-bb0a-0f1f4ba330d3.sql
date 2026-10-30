-- Add subscription health tracking columns to push_subscriptions table
ALTER TABLE public.push_subscriptions 
ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_failure_reason TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Create index for querying unhealthy subscriptions
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_failure_count 
ON public.push_subscriptions(failure_count) 
WHERE failure_count > 0;

-- Create index for stale subscription cleanup
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_last_success 
ON public.push_subscriptions(last_success_at);

-- Function to record a successful push delivery
CREATE OR REPLACE FUNCTION public.record_push_success(p_endpoint TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.push_subscriptions
  SET 
    last_success_at = now(),
    failure_count = 0,
    last_failure_at = NULL,
    last_failure_reason = NULL
  WHERE endpoint = p_endpoint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to record a push delivery failure
CREATE OR REPLACE FUNCTION public.record_push_failure(
  p_endpoint TEXT, 
  p_reason TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE public.push_subscriptions
  SET 
    failure_count = COALESCE(failure_count, 0) + 1,
    last_failure_at = now(),
    last_failure_reason = p_reason
  WHERE endpoint = p_endpoint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get subscription health stats for a user
CREATE OR REPLACE FUNCTION public.get_push_subscription_health(p_user_id UUID)
RETURNS TABLE (
  endpoint TEXT,
  platform TEXT,
  failure_count INTEGER,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_failure_at TIMESTAMP WITH TIME ZONE,
  last_failure_reason TEXT,
  age_hours NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ps.endpoint,
    ps.platform,
    ps.failure_count,
    ps.last_success_at,
    ps.last_failure_at,
    ps.last_failure_reason,
    EXTRACT(EPOCH FROM (now() - ps.created_at)) / 3600 AS age_hours
  FROM public.push_subscriptions ps
  WHERE ps.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.record_push_success(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_push_failure(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_subscription_health(UUID) TO authenticated;