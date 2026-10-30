UPDATE public.profiles 
SET terms_accepted_at = created_at, 
    privacy_accepted_at = created_at 
WHERE terms_accepted_at IS NULL 
  AND display_name IS NOT NULL;