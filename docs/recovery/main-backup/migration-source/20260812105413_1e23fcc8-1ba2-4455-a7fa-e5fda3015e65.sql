
-- Helper: is user a league admin for the competition's organising club (or app admin)
CREATE OR REPLACE FUNCTION public.is_competition_league_admin(_user_id uuid, _competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.competitions c
    JOIN public.user_roles ur
      ON ur.user_id = _user_id
     AND ur.role = 'league_admin'
     AND (ur.club_id = c.organizer_club_id OR ur.club_id IS NULL)
    WHERE c.id = _competition_id
  );
$$;

-- Enforce: owner must be a league admin, otherwise transfer to one
CREATE OR REPLACE FUNCTION public.enforce_competition_owner_is_league_admin(_competition_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_new_owner uuid;
  v_club uuid;
BEGIN
  SELECT organizer_club_id INTO v_club FROM public.competitions WHERE id = _competition_id;
  IF v_club IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO v_owner
  FROM public.competition_roles
  WHERE competition_id = _competition_id AND role = 'owner'
  ORDER BY created_at
  LIMIT 1;

  IF v_owner IS NOT NULL AND public.is_competition_league_admin(v_owner, _competition_id) THEN
    RETURN v_owner;
  END IF;

  -- Prefer an existing competition admin who is a league admin, else any league admin of the club
  SELECT cr.user_id INTO v_new_owner
  FROM public.competition_roles cr
  WHERE cr.competition_id = _competition_id
    AND cr.role IN ('admin','owner')
    AND cr.user_id IS DISTINCT FROM v_owner
    AND public.is_competition_league_admin(cr.user_id, _competition_id)
  ORDER BY cr.created_at
  LIMIT 1;

  IF v_new_owner IS NULL THEN
    SELECT ur.user_id INTO v_new_owner
    FROM public.user_roles ur
    WHERE ur.role = 'league_admin'
      AND ur.club_id = v_club
      AND ur.user_id IS DISTINCT FROM v_owner
    ORDER BY ur.created_at
    LIMIT 1;
  END IF;

  IF v_new_owner IS NULL THEN
    -- No eligible league admin: leave ownership untouched
    RETURN v_owner;
  END IF;

  -- Demote current owner to admin (keep access), promote new owner
  IF v_owner IS NOT NULL THEN
    UPDATE public.competition_roles
    SET role = 'admin'
    WHERE competition_id = _competition_id AND user_id = v_owner AND role = 'owner';
  END IF;

  DELETE FROM public.competition_roles
  WHERE competition_id = _competition_id AND user_id = v_new_owner;

  INSERT INTO public.competition_roles (competition_id, user_id, role)
  VALUES (_competition_id, v_new_owner, 'owner')
  ON CONFLICT DO NOTHING;

  PERFORM public.sync_competition_coord_chat_members(_competition_id);

  RETURN v_new_owner;
END;
$$;

-- Run after competition insert / organiser club change
CREATE OR REPLACE FUNCTION public.tg_competition_enforce_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enforce_competition_owner_is_league_admin(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_enforce_owner ON public.competitions;
CREATE TRIGGER trg_competition_enforce_owner
AFTER INSERT ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_enforce_owner();

DROP TRIGGER IF EXISTS trg_competition_club_enforce_owner ON public.competitions;
CREATE TRIGGER trg_competition_club_enforce_owner
AFTER UPDATE OF organizer_club_id ON public.competitions
FOR EACH ROW
WHEN (NEW.organizer_club_id IS DISTINCT FROM OLD.organizer_club_id)
EXECUTE FUNCTION public.tg_competition_enforce_owner();

-- Run when competition roles change
CREATE OR REPLACE FUNCTION public.tg_competition_roles_enforce_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp uuid := COALESCE(NEW.competition_id, OLD.competition_id);
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    PERFORM public.enforce_competition_owner_is_league_admin(v_comp);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_roles_enforce_owner ON public.competition_roles;
CREATE TRIGGER trg_competition_roles_enforce_owner
AFTER INSERT OR UPDATE OR DELETE ON public.competition_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_roles_enforce_owner();

-- Run when league_admin roles are granted / removed
CREATE OR REPLACE FUNCTION public.tg_league_admin_enforce_competition_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_club uuid := COALESCE(NEW.club_id, OLD.club_id);
  v_role text := COALESCE(NEW.role, OLD.role)::text;
BEGIN
  IF v_role <> 'league_admin' OR v_club IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR v_row IN
    SELECT id FROM public.competitions WHERE organizer_club_id = v_club
  LOOP
    PERFORM public.enforce_competition_owner_is_league_admin(v_row.id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_league_admin_enforce_competition_owner ON public.user_roles;
CREATE TRIGGER trg_league_admin_enforce_competition_owner
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_league_admin_enforce_competition_owner();
