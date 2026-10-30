
-- Create blocked_users table
CREATE TABLE public.blocked_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);

-- Enable RLS
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Users can view their own blocks
CREATE POLICY "Users can view their own blocks"
ON public.blocked_users
FOR SELECT
USING (auth.uid() = blocker_id);

-- Users can block others
CREATE POLICY "Users can block others"
ON public.blocked_users
FOR INSERT
WITH CHECK (auth.uid() = blocker_id AND blocker_id != blocked_id);

-- Users can unblock
CREATE POLICY "Users can unblock"
ON public.blocked_users
FOR DELETE
USING (auth.uid() = blocker_id);

-- Create a security definer function to check if a user is blocked (for use in queries)
CREATE OR REPLACE FUNCTION public.is_blocked_by(_blocker_id uuid, _blocked_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = _blocker_id AND blocked_id = _blocked_id
  )
$$;

-- Create trigger to notify developer (insert admin_alert) when someone blocks a user
CREATE OR REPLACE FUNCTION public.on_user_blocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  blocker_name text;
  blocked_name text;
BEGIN
  SELECT display_name INTO blocker_name FROM public.profiles WHERE id = NEW.blocker_id;
  SELECT display_name INTO blocked_name FROM public.profiles WHERE id = NEW.blocked_id;
  
  INSERT INTO public.admin_alerts (alert_type, details)
  VALUES ('user_blocked', jsonb_build_object(
    'blocker_id', NEW.blocker_id,
    'blocker_name', COALESCE(blocker_name, 'Unknown'),
    'blocked_id', NEW.blocked_id,
    'blocked_name', COALESCE(blocked_name, 'Unknown'),
    'reason', NEW.reason
  ));
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_user_blocked_trigger
AFTER INSERT ON public.blocked_users
FOR EACH ROW
EXECUTE FUNCTION public.on_user_blocked();

-- Index for fast lookup
CREATE INDEX idx_blocked_users_blocker ON public.blocked_users(blocker_id);
CREATE INDEX idx_blocked_users_blocked ON public.blocked_users(blocked_id);
