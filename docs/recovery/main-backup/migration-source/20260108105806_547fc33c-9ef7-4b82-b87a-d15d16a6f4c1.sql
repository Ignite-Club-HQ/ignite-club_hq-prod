-- Add RLS policies for photo_reactions
CREATE POLICY "Users can view photo reactions" 
ON public.photo_reactions FOR SELECT 
USING (true);

CREATE POLICY "Users can add reactions to photos" 
ON public.photo_reactions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their own reactions" 
ON public.photo_reactions FOR DELETE 
USING (auth.uid() = user_id);

-- Add RLS policies for message_reactions
CREATE POLICY "Users can view message reactions" 
ON public.message_reactions FOR SELECT 
USING (true);

CREATE POLICY "Users can add message reactions" 
ON public.message_reactions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their own message reactions" 
ON public.message_reactions FOR DELETE 
USING (auth.uid() = user_id);