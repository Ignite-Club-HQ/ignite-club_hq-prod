-- Secure sensitive database functions with authorization checks

-- 1. Revoke public execute on encrypt/decrypt functions
-- These should only be called internally by other trusted functions
REVOKE EXECUTE ON FUNCTION public.encrypt_sensitive_data(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.encrypt_sensitive_data(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.encrypt_sensitive_data(text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.decrypt_sensitive_data(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.decrypt_sensitive_data(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrypt_sensitive_data(text) FROM authenticated;

-- 2. Secure get_user_emails_by_ids - only app_admin can access user emails
CREATE OR REPLACE FUNCTION public.get_user_emails_by_ids(user_ids uuid[])
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = calling_user_id AND ur.role = 'app_admin'
  ) INTO is_authorized;
  
  -- Deny access if not authorized
  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Access denied: Must be app_admin to access user emails';
  END IF;
  
  -- Return emails if authorized
  RETURN QUERY
  SELECT au.id as user_id, au.email
  FROM auth.users au
  WHERE au.id = ANY(user_ids)
    AND au.email IS NOT NULL;
END;
$function$;

-- 3. Secure get_user_by_email_for_passkey - add basic validation
-- This is needed for passkey authentication flow, but should have some protection
CREATE OR REPLACE FUNCTION public.get_user_by_email_for_passkey(lookup_email text)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Basic validation - email must be provided
  IF lookup_email IS NULL OR lookup_email = '' THEN
    RETURN;
  END IF;
  
  -- Normalize email and validate format
  lookup_email := lower(trim(lookup_email));
  
  IF lookup_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RETURN;
  END IF;
  
  -- Return user ID (this is needed for passkey auth flow)
  -- The function returns minimal data (just ID) which is acceptable
  RETURN QUERY
  SELECT au.id
  FROM auth.users au
  WHERE au.email = lookup_email
  LIMIT 1;
END;
$function$;