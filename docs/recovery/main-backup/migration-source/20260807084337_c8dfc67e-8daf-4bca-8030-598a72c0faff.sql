-- 1. Marker on user_roles for captain-derived team admin rights
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS via_captain boolean NOT NULL DEFAULT false;

-- 2. Persistent team captains (senior / mixed teams only)
CREATE TABLE IF NOT EXISTS public.team_captains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_captains TO authenticated;
GRANT ALL ON public.team_captains TO service_role;

ALTER TABLE public.team_captains ENABLE ROW LEVEL SECURITY;

-- Anyone who can see the team roster can see who the captain is
CREATE POLICY "Team members can view team captains"
ON public.team_captains FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid()) AND ur.team_id = team_captains.team_id
  )
  OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_captains.team_id
      AND public.has_role((SELECT auth.uid()), 'club_admin'::app_role, t.club_id, NULL::uuid)
  )
);

-- Only real (non-captain-derived) team admins, club admins and app admins can assign captains
CREATE OR REPLACE FUNCTION public.can_manage_team_captains(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.team_id = _team_id
      AND ur.role = 'team_admin'::app_role
      AND ur.via_captain = false
  )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.user_roles ur ON ur.user_id = _user_id
      AND ur.club_id = t.club_id
      AND ur.role = 'club_admin'::app_role
    WHERE t.id = _team_id
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'app_admin'::app_role
  );
$$;

CREATE POLICY "Admins can assign team captains"
ON public.team_captains FOR INSERT TO authenticated
WITH CHECK (public.can_manage_team_captains((SELECT auth.uid()), team_id));

CREATE POLICY "Admins can remove team captains"
ON public.team_captains FOR DELETE TO authenticated
USING (public.can_manage_team_captains((SELECT auth.uid()), team_id));

-- 3. Captaincy is only valid for senior / mixed teams
CREATE OR REPLACE FUNCTION public.validate_team_captain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_type text;
BEGIN
  SELECT lower(coalesce(team_type, 'mixed')) INTO t_type FROM public.teams WHERE id = NEW.team_id;
  IF t_type IS NULL OR t_type NOT IN ('senior', 'mixed') THEN
    RAISE EXCEPTION 'Captains with management rights are only supported for senior or mixed teams';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_team_captain ON public.team_captains;
CREATE TRIGGER trg_validate_team_captain
BEFORE INSERT ON public.team_captains
FOR EACH ROW EXECUTE FUNCTION public.validate_team_captain();

-- 4. Captain gets team_admin rights (marked via_captain) automatically
CREATE OR REPLACE FUNCTION public.sync_team_captain_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = NEW.user_id AND ur.team_id = NEW.team_id AND ur.role = 'team_admin'::app_role
    ) THEN
      INSERT INTO public.user_roles (user_id, team_id, club_id, role, via_captain)
      SELECT NEW.user_id, NEW.team_id, t.club_id, 'team_admin'::app_role, true
      FROM public.teams t WHERE t.id = NEW.team_id;
    END IF;
    RETURN NEW;
  ELSE
    DELETE FROM public.user_roles ur
    WHERE ur.user_id = OLD.user_id
      AND ur.team_id = OLD.team_id
      AND ur.role = 'team_admin'::app_role
      AND ur.via_captain = true;
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_team_captain_role_ins ON public.team_captains;
CREATE TRIGGER trg_sync_team_captain_role_ins
AFTER INSERT ON public.team_captains
FOR EACH ROW EXECUTE FUNCTION public.sync_team_captain_role();

DROP TRIGGER IF EXISTS trg_sync_team_captain_role_del ON public.team_captains;
CREATE TRIGGER trg_sync_team_captain_role_del
AFTER DELETE ON public.team_captains
FOR EACH ROW EXECUTE FUNCTION public.sync_team_captain_role();

CREATE TRIGGER trg_team_captains_updated_at
BEFORE UPDATE ON public.team_captains
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Captain-derived admins must not be able to edit team settings
DROP POLICY IF EXISTS "Team admins can update teams" ON public.teams;
CREATE POLICY "Team admins can update teams"
ON public.teams FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.team_id = teams.id
      AND ur.role = 'team_admin'::app_role
      AND ur.via_captain = false
  )
  OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);

-- 6. Helper for client / server checks
CREATE OR REPLACE FUNCTION public.is_team_captain(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_captains tc
    WHERE tc.user_id = _user_id AND tc.team_id = _team_id
  );
$$;