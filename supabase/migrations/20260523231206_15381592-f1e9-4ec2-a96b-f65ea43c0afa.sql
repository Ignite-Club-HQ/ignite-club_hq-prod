
-- 1. Add join_policy column
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS join_policy text NOT NULL DEFAULT 'invite_only';

ALTER TABLE public.chat_groups
  DROP CONSTRAINT IF EXISTS chat_groups_join_policy_check;
ALTER TABLE public.chat_groups
  ADD CONSTRAINT chat_groups_join_policy_check
  CHECK (join_policy IN ('invite_only','open_to_club'));

-- 2. Backfill existing Operations/Volunteers club-scoped manual groups
UPDATE public.chat_groups
SET join_policy = 'open_to_club'
WHERE club_id IS NOT NULL
  AND team_id IS NULL
  AND mini_league_id IS NULL
  AND membership_mode = 'manual'
  AND category IN ('Operations','Volunteers')
  AND deleted_at IS NULL
  AND join_policy = 'invite_only';

-- 3. Trigger: default join_policy based on category for qualifying groups
CREATE OR REPLACE FUNCTION public.set_chat_group_join_policy_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only auto-manage for club-scoped manual groups
  IF NEW.club_id IS NOT NULL
     AND NEW.team_id IS NULL
     AND NEW.mini_league_id IS NULL
     AND NEW.membership_mode = 'manual'
     AND NEW.category IN ('Operations','Volunteers')
  THEN
    -- On insert, if not explicitly set, open to club
    IF TG_OP = 'INSERT' AND NEW.join_policy = 'invite_only' THEN
      NEW.join_policy := 'open_to_club';
    END IF;
  ELSE
    -- Outside the qualifying scope, force invite_only
    NEW.join_policy := 'invite_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_groups_join_policy_default ON public.chat_groups;
CREATE TRIGGER trg_chat_groups_join_policy_default
  BEFORE INSERT OR UPDATE OF category, membership_mode, club_id, team_id, mini_league_id, join_policy
  ON public.chat_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.set_chat_group_join_policy_default();

-- 4. Extra RLS SELECT policy so club members can DISCOVER open_to_club groups
--    even before they join (existing can_access_chat_group still gates messages).
DROP POLICY IF EXISTS "Club members can discover open groups" ON public.chat_groups;
CREATE POLICY "Club members can discover open groups"
ON public.chat_groups
FOR SELECT
USING (
  deleted_at IS NULL
  AND join_policy = 'open_to_club'
  AND club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.club_id = chat_groups.club_id
  )
);

-- 5. Self-join RPC
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

  -- Caller must be a member of the parent club
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user AND ur.club_id = v_group.club_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this club' USING ERRCODE = '42501';
  END IF;

  -- Already a member?
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

GRANT EXECUTE ON FUNCTION public.join_open_chat_group(uuid) TO authenticated;
