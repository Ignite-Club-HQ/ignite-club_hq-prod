-- Fix critical vulnerability: Add authorization checks to get_club_stripe_config
-- Only club_admin of the specified club or app_admin can access Stripe config

CREATE OR REPLACE FUNCTION public.get_club_stripe_config(p_club_id uuid)
 RETURNS TABLE(id uuid, club_id uuid, stripe_secret_key text, stripe_publishable_key text, is_enabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  calling_user_id uuid;
  is_authorized boolean := false;
BEGIN
  -- Get the calling user's ID
  calling_user_id := auth.uid();
  
  -- Check if user is authenticated
  IF calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check if user is app_admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = calling_user_id AND role = 'app_admin'
  ) INTO is_authorized;
  
  -- If not app_admin, check if user is club_admin for this specific club
  IF NOT is_authorized THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = calling_user_id 
        AND role = 'club_admin' 
        AND user_roles.club_id = p_club_id
    ) INTO is_authorized;
  END IF;
  
  -- Deny access if not authorized
  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Access denied: Must be club_admin or app_admin';
  END IF;
  
  -- Return the config if authorized
  RETURN QUERY
  SELECT 
    csc.id,
    csc.club_id,
    CASE 
      WHEN csc.stripe_secret_key_encrypted IS NOT NULL 
      THEN public.decrypt_sensitive_data(csc.stripe_secret_key_encrypted)
      ELSE csc.stripe_secret_key
    END as stripe_secret_key,
    CASE 
      WHEN csc.stripe_publishable_key_encrypted IS NOT NULL 
      THEN public.decrypt_sensitive_data(csc.stripe_publishable_key_encrypted)
      ELSE csc.stripe_publishable_key
    END as stripe_publishable_key,
    csc.is_enabled
  FROM public.club_stripe_configs csc
  WHERE csc.club_id = p_club_id;
END;
$function$;