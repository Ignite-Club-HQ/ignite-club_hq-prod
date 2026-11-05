
-- 1) Tighten access function: drop generic 'coach', include per-league mini_league_admins grants
CREATE OR REPLACE FUNCTION public.can_access_chat_group(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_groups cg
    WHERE cg.id = _group_id
      AND (
        -- Personal groups
        (cg.club_id IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = cg.id AND gm.user_id = _user_id
        ))
        -- Club groups
        OR (cg.club_id IS NOT NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id
            AND ur.club_id = cg.club_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
        -- Team groups
        OR (cg.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = _user_id
            AND ur.team_id = cg.team_id
            AND ur.role = ANY(cg.allowed_roles)
        ))
        -- Mini-league groups
        OR (cg.mini_league_id IS NOT NULL AND (
          -- Club admins / app admins / club-wide league admins
          EXISTS (
            SELECT 1 FROM public.user_roles ur
            JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
            WHERE ml.id = cg.mini_league_id
              AND ur.user_id = _user_id
              AND ur.role IN ('league_admin','club_admin','app_admin')
          )
          -- Per-mini-league granted admins
          OR EXISTS (
            SELECT 1 FROM public.mini_league_admins mla
            WHERE mla.mini_league_id = cg.mini_league_id
              AND mla.user_id = _user_id
          )
          -- Parents of players in this mini-league
          OR EXISTS (
            SELECT 1 FROM public.mini_league_players mlp
            WHERE mlp.mini_league_id = cg.mini_league_id
              AND mlp.parent_user_id = _user_id
          )
        ))
      )
  )
$function$;

-- 2) Replace the explicit mini-league SELECT policy on chat_groups to match
DROP POLICY IF EXISTS "Users can access mini league chats" ON public.chat_groups;
CREATE POLICY "Users can access mini league chats"
ON public.chat_groups
FOR SELECT
USING (
  mini_league_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = chat_groups.mini_league_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('league_admin','club_admin','app_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.mini_league_admins mla
      WHERE mla.mini_league_id = chat_groups.mini_league_id
        AND mla.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.mini_league_players mlp
      WHERE mlp.mini_league_id = chat_groups.mini_league_id
        AND mlp.parent_user_id = auth.uid()
    )
  )
);

-- 3) Trigger: auto-create chat_group on mini_league insert
CREATE OR REPLACE FUNCTION public.create_mini_league_chat_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.chat_groups (name, club_id, mini_league_id, allowed_roles, created_by)
  VALUES (NEW.name, NEW.club_id, NEW.id, ARRAY[]::app_role[], NEW.created_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_mini_league_chat_group ON public.mini_leagues;
CREATE TRIGGER trg_create_mini_league_chat_group
AFTER INSERT ON public.mini_leagues
FOR EACH ROW EXECUTE FUNCTION public.create_mini_league_chat_group();

-- 4) Trigger: keep chat_group name in sync with mini_league name
CREATE OR REPLACE FUNCTION public.sync_mini_league_chat_group_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.chat_groups
       SET name = NEW.name, updated_at = now()
     WHERE mini_league_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_mini_league_chat_group_name ON public.mini_leagues;
CREATE TRIGGER trg_sync_mini_league_chat_group_name
AFTER UPDATE ON public.mini_leagues
FOR EACH ROW EXECUTE FUNCTION public.sync_mini_league_chat_group_name();

-- 5) Ensure unique chat_group per mini_league (so backfill / trigger are idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS chat_groups_mini_league_id_unique
  ON public.chat_groups(mini_league_id)
  WHERE mini_league_id IS NOT NULL;

-- 6) Backfill chat_groups for existing mini_leagues that don't have one
INSERT INTO public.chat_groups (name, club_id, mini_league_id, allowed_roles, created_by)
SELECT ml.name, ml.club_id, ml.id, ARRAY[]::app_role[], ml.created_by
FROM public.mini_leagues ml
LEFT JOIN public.chat_groups cg ON cg.mini_league_id = ml.id
WHERE cg.id IS NULL;
