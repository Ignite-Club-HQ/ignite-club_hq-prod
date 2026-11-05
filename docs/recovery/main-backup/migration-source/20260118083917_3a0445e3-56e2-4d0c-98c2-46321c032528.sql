-- Drop existing policy and create a new one that includes both app_admin and club_admin
DROP POLICY IF EXISTS "App admins can manage promo codes" ON public.promo_codes;

-- App admins can see/manage all promo codes
-- Club admins can see/manage promo codes for their clubs or codes with no club restriction
CREATE POLICY "Admins can manage promo codes" ON public.promo_codes
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (
      user_roles.role = 'app_admin'
      OR (
        user_roles.role = 'club_admin' 
        AND (promo_codes.club_id IS NULL OR promo_codes.club_id = user_roles.club_id)
      )
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (
      user_roles.role = 'app_admin'
      OR (
        user_roles.role = 'club_admin' 
        AND (promo_codes.club_id IS NULL OR promo_codes.club_id = user_roles.club_id)
      )
    )
  )
);