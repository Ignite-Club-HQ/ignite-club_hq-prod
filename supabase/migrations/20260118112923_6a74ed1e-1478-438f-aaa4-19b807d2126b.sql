-- Fix the can_access_chat_group function to also check group_members for personal groups
CREATE OR REPLACE FUNCTION public.can_access_chat_group(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.chat_groups cg
    WHERE cg.id = _group_id
      AND (
        -- Personal groups: user must be in group_members
        (cg.club_id IS NULL AND cg.team_id IS NULL AND EXISTS (
          SELECT 1 FROM public.group_members gm 
          WHERE gm.group_id = cg.id AND gm.user_id = _user_id
        ))
        -- Club groups: user must be a member of the club with an allowed role
        OR (cg.club_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id 
            AND ur.club_id = cg.club_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
        -- Team groups: user must be a member of the team with an allowed role
        OR (cg.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id 
            AND ur.team_id = cg.team_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
      )
  )
$$;

-- Drop the broken policy for viewing chat_groups
DROP POLICY IF EXISTS "Users can view accessible groups" ON public.chat_groups;

-- Create a new correct policy that uses the fixed function
CREATE POLICY "Users can view accessible groups"
ON public.chat_groups
FOR SELECT
TO authenticated
USING (
  -- Creator can always see their groups
  created_by = auth.uid()
  -- Or use the function to check access
  OR can_access_chat_group(auth.uid(), id)
);