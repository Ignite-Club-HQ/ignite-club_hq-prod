-- Club admins can view redemptions for their club's rewards
CREATE POLICY "Club admins can view club redemptions"
ON public.reward_redemptions
FOR SELECT
USING (
  reward_id IN (
    SELECT cr.id FROM club_rewards cr
    WHERE cr.club_id IN (
      SELECT ur.club_id FROM user_roles ur 
      WHERE ur.user_id = auth.uid() AND ur.role = 'club_admin' AND ur.club_id IS NOT NULL
    )
  )
);

-- Club admins can update (verify) redemptions for their club's rewards
CREATE POLICY "Club admins can update club redemptions"
ON public.reward_redemptions
FOR UPDATE
USING (
  reward_id IN (
    SELECT cr.id FROM club_rewards cr
    WHERE cr.club_id IN (
      SELECT ur.club_id FROM user_roles ur 
      WHERE ur.user_id = auth.uid() AND ur.role = 'club_admin' AND ur.club_id IS NOT NULL
    )
  )
);