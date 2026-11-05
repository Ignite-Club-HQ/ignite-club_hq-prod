-- Drop the old duplicate policy
DROP POLICY IF EXISTS "Users can view chat groups they have access to" ON public.chat_groups;