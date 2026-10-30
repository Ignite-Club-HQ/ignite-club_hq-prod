-- Drop the current policy and recreate with proper enum casting
DROP POLICY IF EXISTS "Admins can manage promo codes" ON public.promo_codes;

-- Create policy with explicit enum casting
CREATE POLICY "Admins can manage promo codes" ON public.promo_codes
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (
      user_roles.role = 'app_admin'::app_role
      OR (
        user_roles.role = 'club_admin'::app_role
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
      user_roles.role = 'app_admin'::app_role
      OR (
        user_roles.role = 'club_admin'::app_role
        AND (promo_codes.club_id IS NULL OR promo_codes.club_id = user_roles.club_id)
      )
    )
  )
);