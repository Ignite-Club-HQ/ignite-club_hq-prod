-- Users can view their own redemptions
CREATE POLICY "Users can view their own redemptions"
ON public.reward_redemptions
FOR SELECT
USING (user_id = auth.uid() OR child_id IN (SELECT id FROM children WHERE parent_id = auth.uid()));

-- Users can insert their own redemptions
CREATE POLICY "Users can insert their own redemptions"
ON public.reward_redemptions
FOR INSERT
WITH CHECK (user_id = auth.uid() OR child_id IN (SELECT id FROM children WHERE parent_id = auth.uid()));

-- Users can update their own redemptions
CREATE POLICY "Users can update their own redemptions"
ON public.reward_redemptions
FOR UPDATE
USING (user_id = auth.uid() OR child_id IN (SELECT id FROM children WHERE parent_id = auth.uid()));