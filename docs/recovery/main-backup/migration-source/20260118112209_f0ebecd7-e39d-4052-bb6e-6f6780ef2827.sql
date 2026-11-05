-- Create group_members table to track members of personal group chats
CREATE TABLE public.group_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  added_by UUID REFERENCES public.profiles(id),
  UNIQUE(group_id, user_id)
);

-- Enable RLS
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Policy: Group creators can manage members
CREATE POLICY "Group creators can manage members"
ON public.group_members
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.chat_groups
    WHERE id = group_members.group_id
    AND created_by = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.chat_groups
    WHERE id = group_members.group_id
    AND created_by = auth.uid()
  )
);

-- Policy: Members can view group members
CREATE POLICY "Members can view group members"
ON public.group_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_members.group_id
    AND gm.user_id = auth.uid()
  )
);

-- Policy: Users can add themselves to groups they're invited to
CREATE POLICY "Users can join groups"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.chat_groups
    WHERE id = group_members.group_id
    AND created_by = auth.uid()
  )
);

-- Create index for faster lookups
CREATE INDEX idx_group_members_group_id ON public.group_members(group_id);
CREATE INDEX idx_group_members_user_id ON public.group_members(user_id);