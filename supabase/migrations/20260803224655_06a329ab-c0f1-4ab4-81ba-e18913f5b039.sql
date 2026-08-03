-- 1. Extend allowed join policies
ALTER TABLE public.chat_groups DROP CONSTRAINT IF EXISTS chat_groups_join_policy_check;
ALTER TABLE public.chat_groups
  ADD CONSTRAINT chat_groups_join_policy_check
  CHECK (join_policy IN ('invite_only','request_to_join','open_to_club'));

-- 2. Preserve today's behaviour: discoverable groups currently require approval
UPDATE public.chat_groups
SET join_policy = 'request_to_join'
WHERE join_policy = 'open_to_club';

-- 3. Trigger default: new qualifying groups require approval
CREATE OR REPLACE FUNCTION public.set_chat_group_join_policy_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.club_id IS NOT NULL
     AND NEW.team_id IS NULL
     AND NEW.mini_league_id IS NULL
     AND NEW.membership_mode = 'manual'
     AND NEW.category IN ('Operations','Volunteers')
  THEN
    IF TG_OP = 'INSERT' AND NEW.join_policy = 'invite_only' THEN
      NEW.join_policy := 'request_to_join';
    END IF;
  ELSE
    NEW.join_policy := 'invite_only';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Discovery visibility for both self-serve policies
DROP POLICY IF EXISTS "Club members can discover open groups" ON public.chat_groups;
CREATE POLICY "Club members can discover open groups"
ON public.chat_groups
FOR SELECT
USING (
  deleted_at IS NULL
  AND join_policy IN ('open_to_club','request_to_join')
  AND club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid()) AND ur.club_id = chat_groups.club_id
  )
);

-- 5. Members adding club members works for both self-serve policies
DROP POLICY IF EXISTS "Members can add to open club groups" ON public.group_members;
CREATE POLICY "Members can add to open club groups"
ON public.group_members
FOR INSERT
WITH CHECK (
  added_by = auth.uid()
  AND is_group_member(group_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.chat_groups cg
    WHERE cg.id = group_members.group_id
      AND cg.club_id IS NOT NULL
      AND cg.team_id IS NULL
      AND cg.mini_league_id IS NULL
      AND cg.join_policy IN ('open_to_club','request_to_join')
      AND cg.category IN ('Operations', 'Volunteers')
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = group_members.user_id
          AND ur.club_id = cg.club_id
      )
  )
);

-- 6. Instant self-join only for 'open_to_club'
CREATE OR REPLACE FUNCTION public.join_open_chat_group(_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_group public.chat_groups%ROWTYPE;
  v_member_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_group FROM public.chat_groups WHERE id = _group_id;
  IF NOT FOUND OR v_group.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_group.join_policy <> 'open_to_club'
     OR v_group.club_id IS NULL
     OR v_group.team_id IS NOT NULL
     OR v_group.mini_league_id IS NOT NULL
     OR v_group.category NOT IN ('Operations','Volunteers')
  THEN
    RAISE EXCEPTION 'Group is not open to self-join' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user AND ur.club_id = v_group.club_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this club' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_member_id
  FROM public.group_members
  WHERE group_id = _group_id AND user_id = v_user
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    RETURN v_member_id;
  END IF;

  INSERT INTO public.group_members (group_id, user_id, added_by)
  VALUES (_group_id, v_user, v_user)
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;

-- 7. Join requests only for 'request_to_join'
CREATE OR REPLACE FUNCTION public.request_join_chat_group(_group_id uuid, _message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_group public.chat_groups%ROWTYPE;
  v_request_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_group FROM public.chat_groups WHERE id = _group_id;
  IF NOT FOUND OR v_group.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_group.join_policy <> 'request_to_join'
     OR v_group.club_id IS NULL
     OR v_group.team_id IS NOT NULL
     OR v_group.mini_league_id IS NOT NULL
     OR v_group.category NOT IN ('Operations','Volunteers')
  THEN
    RAISE EXCEPTION 'Group does not accept join requests' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user AND ur.club_id = v_group.club_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this club' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group_id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Already a member' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_request_id
  FROM public.chat_group_join_requests
  WHERE group_id = _group_id AND user_id = v_user AND status = 'pending'
  LIMIT 1;
  IF v_request_id IS NOT NULL THEN
    RETURN v_request_id;
  END IF;

  INSERT INTO public.chat_group_join_requests (group_id, user_id, message)
  VALUES (_group_id, v_user, _message)
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_open_chat_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_join_chat_group(uuid, text) TO authenticated;