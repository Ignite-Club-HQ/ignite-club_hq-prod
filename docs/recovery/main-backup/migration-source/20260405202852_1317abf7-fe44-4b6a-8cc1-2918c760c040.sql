-- Add missing UPDATE RLS policy
CREATE POLICY "Users can update their own comment reactions"
ON public.photo_comment_reactions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Fix unique constraint: should be (comment_id, user_id) not (comment_id, user_id, reaction_type)
ALTER TABLE public.photo_comment_reactions
DROP CONSTRAINT IF EXISTS photo_comment_reactions_comment_id_user_id_reaction_type_key;

-- Delete duplicate reactions per user per comment (keep latest)
DELETE FROM public.photo_comment_reactions a
USING public.photo_comment_reactions b
WHERE a.comment_id = b.comment_id
  AND a.user_id = b.user_id
  AND a.id < b.id;

ALTER TABLE public.photo_comment_reactions
ADD CONSTRAINT photo_comment_reactions_comment_id_user_id_key UNIQUE (comment_id, user_id);