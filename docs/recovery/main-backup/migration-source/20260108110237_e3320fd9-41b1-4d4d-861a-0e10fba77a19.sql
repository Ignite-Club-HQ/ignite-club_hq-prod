-- Add RLS policies for photo_comments
CREATE POLICY "Users can view photo comments" 
ON public.photo_comments FOR SELECT 
USING (true);

CREATE POLICY "Users can add comments to photos" 
ON public.photo_comments FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own comments" 
ON public.photo_comments FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comments" 
ON public.photo_comments FOR DELETE 
USING (auth.uid() = user_id);

-- Also add policies for photo_comment_reactions
CREATE POLICY "Users can view comment reactions" 
ON public.photo_comment_reactions FOR SELECT 
USING (true);

CREATE POLICY "Users can add comment reactions" 
ON public.photo_comment_reactions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their own comment reactions" 
ON public.photo_comment_reactions FOR DELETE 
USING (auth.uid() = user_id);