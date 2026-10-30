-- Drop existing policy and recreate with proper INSERT support
DROP POLICY IF EXISTS "Users can manage their own push subscriptions" ON push_subscriptions;

-- Create separate policies for each operation
CREATE POLICY "Users can view their own push subscriptions" 
ON push_subscriptions 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own push subscriptions" 
ON push_subscriptions 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own push subscriptions" 
ON push_subscriptions 
FOR UPDATE 
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own push subscriptions" 
ON push_subscriptions 
FOR DELETE 
USING (user_id = auth.uid());