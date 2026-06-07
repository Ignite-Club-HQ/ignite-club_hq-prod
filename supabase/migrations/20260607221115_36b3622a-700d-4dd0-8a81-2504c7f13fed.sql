
UPDATE public.chat_groups
SET allowed_roles = ARRAY['league_admin','coach','club_admin','parent','app_admin']::app_role[]
WHERE mini_league_id IS NOT NULL
  AND (allowed_roles IS NULL OR cardinality(allowed_roles) = 0);

INSERT INTO public.chat_groups (name, club_id, mini_league_id, allowed_roles, membership_mode, join_policy, created_by)
SELECT
  ml.name || ' Chat',
  ml.club_id,
  ml.id,
  ARRAY['league_admin','coach','club_admin','parent','app_admin']::app_role[],
  'role',
  'invite_only',
  ml.created_by
FROM public.mini_leagues ml
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_groups cg WHERE cg.mini_league_id = ml.id AND cg.deleted_at IS NULL
);

CREATE OR REPLACE FUNCTION public.create_mini_league_chat_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_groups WHERE mini_league_id = NEW.id AND deleted_at IS NULL
  ) THEN
    INSERT INTO public.chat_groups (name, club_id, mini_league_id, allowed_roles, membership_mode, join_policy, created_by)
    VALUES (
      NEW.name || ' Chat',
      NEW.club_id,
      NEW.id,
      ARRAY['league_admin','coach','club_admin','parent','app_admin']::app_role[],
      'role',
      'invite_only',
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_mini_league_chat_group ON public.mini_leagues;
CREATE TRIGGER trg_create_mini_league_chat_group
AFTER INSERT ON public.mini_leagues
FOR EACH ROW EXECUTE FUNCTION public.create_mini_league_chat_group();

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
        (cg.club_id IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.group_members gm WHERE gm.group_id = cg.id AND gm.user_id = _user_id
        ))
        OR (
          cg.membership_mode = 'manual'
          AND (cg.club_id IS NOT NULL OR cg.team_id IS NOT NULL OR cg.mini_league_id IS NOT NULL)
          AND (
            EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = cg.id AND gm.user_id = _user_id)
            OR EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = _user_id AND ur.role IN ('club_admin','app_admin')
                AND ((cg.club_id IS NOT NULL AND ur.club_id = cg.club_id) OR ur.role = 'app_admin')
            )
          )
        )
        OR (
          cg.membership_mode = 'role'
          AND cg.club_id IS NOT NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id AND ur.club_id = cg.club_id AND ur.role = ANY(cg.allowed_roles)
          )
        )
        OR (
          cg.membership_mode = 'role'
          AND cg.team_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id AND ur.team_id = cg.team_id AND ur.role = ANY(cg.allowed_roles)
          )
        )
        OR (
          cg.membership_mode = 'role'
          AND cg.mini_league_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM public.user_roles ur
              JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
              WHERE ml.id = cg.mini_league_id AND ur.user_id = _user_id
                AND ur.role IN ('league_admin','club_admin','app_admin')
            )
            OR EXISTS (
              SELECT 1 FROM public.mini_league_admins mla
              WHERE mla.mini_league_id = cg.mini_league_id AND mla.user_id = _user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.mini_league_players mlp
              WHERE mlp.mini_league_id = cg.mini_league_id AND mlp.parent_user_id = _user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.child_mini_league_assignments cma
              JOIN public.children c ON c.id = cma.child_id
              WHERE cma.mini_league_id = cg.mini_league_id AND c.parent_id = _user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.child_mini_league_assignments cma
              JOIN public.child_guardians cgu ON cgu.child_id = cma.child_id
              WHERE cma.mini_league_id = cg.mini_league_id AND cgu.guardian_id = _user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.mini_league_players mlp
              JOIN public.children c ON c.id = mlp.child_id
              WHERE mlp.mini_league_id = cg.mini_league_id AND c.parent_id = _user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.mini_league_players mlp
              JOIN public.child_guardians cgu ON cgu.child_id = mlp.child_id
              WHERE mlp.mini_league_id = cg.mini_league_id AND cgu.guardian_id = _user_id
            )
          )
        )
      )
  )
$function$;
