-- Drop the existing policy
DROP POLICY IF EXISTS "Club/team admins can manage chat groups" ON public.chat_groups;

-- Create separate policies for better clarity

-- 1. Anyone can create a personal group chat (no club_id or team_id)
CREATE POLICY "Users can create personal group chats"
ON public.chat_groups
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid() AND
  club_id IS NULL AND
  team_id IS NULL
);

-- 2. Club admins can create club groups
CREATE POLICY "Club admins can create club groups"
ON public.chat_groups
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid() AND
  club_id IS NOT NULL AND
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND club_id = chat_groups.club_id
    AND role = 'club_admin'
  )
);

-- 3. Team admins/coaches can create team groups
CREATE POLICY "Team admins can create team groups"
ON public.chat_groups
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid() AND
  team_id IS NOT NULL AND
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND team_id = chat_groups.team_id
    AND role IN ('team_admin', 'coach')
  )
);

-- 4. Creators can manage (update/delete) their own groups
CREATE POLICY "Creators can manage their groups"
ON public.chat_groups
FOR ALL
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

-- 5. Users can view groups they have access to
CREATE POLICY "Users can view accessible groups"
ON public.chat_groups
FOR SELECT
TO authenticated
USING (
  -- Personal groups: anyone in allowed_roles
  (club_id IS NULL AND team_id IS NULL) OR
  -- Club groups: members of that club
  (club_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND club_id = chat_groups.club_id
  )) OR
  -- Team groups: members of that team
  (team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND team_id = chat_groups.team_id
  ))
);