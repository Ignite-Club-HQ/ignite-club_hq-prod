-- 1. Trigger function: add creator as a member when a personal chat group is created
CREATE OR REPLACE FUNCTION public.add_creator_to_personal_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only auto-add for personal groups (no team/club/mini_league)
  IF NEW.team_id IS NULL
     AND NEW.club_id IS NULL
     AND NEW.mini_league_id IS NULL
     AND NEW.created_by IS NOT NULL
  THEN
    INSERT INTO public.group_members (group_id, user_id, added_by)
    VALUES (NEW.id, NEW.created_by, NEW.created_by)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Trigger on chat_groups
DROP TRIGGER IF EXISTS on_chat_group_created_add_creator ON public.chat_groups;
CREATE TRIGGER on_chat_group_created_add_creator
AFTER INSERT ON public.chat_groups
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_personal_group();

-- 3. Backfill: add creators of existing personal groups who aren't already members
INSERT INTO public.group_members (group_id, user_id, added_by)
SELECT cg.id, cg.created_by, cg.created_by
FROM public.chat_groups cg
WHERE cg.team_id IS NULL
  AND cg.club_id IS NULL
  AND cg.mini_league_id IS NULL
  AND cg.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = cg.id AND gm.user_id = cg.created_by
  )
ON CONFLICT DO NOTHING;