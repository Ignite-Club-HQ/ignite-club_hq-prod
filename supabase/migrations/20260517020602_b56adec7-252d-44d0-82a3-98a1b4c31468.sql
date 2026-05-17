-- Phase 2: Competitions core schema

CREATE TABLE public.competitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organizer_club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  sport TEXT,
  description TEXT,
  season TEXT,
  starts_on DATE,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'private',
  logo_url TEXT,
  contact_email TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competitions_status_check CHECK (status IN ('draft','open','active','completed','archived')),
  CONSTRAINT competitions_visibility_check CHECK (visibility IN ('private','unlisted','public'))
);
CREATE INDEX idx_competitions_organizer ON public.competitions(organizer_club_id);
CREATE INDEX idx_competitions_status ON public.competitions(status);

CREATE TABLE public.competition_divisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age_group TEXT,
  gender TEXT,
  skill_level TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  max_entries INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_competition_divisions_competition ON public.competition_divisions(competition_id);

CREATE TABLE public.competition_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  division_id UUID REFERENCES public.competition_divisions(id) ON DELETE SET NULL,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited',
  invited_by UUID,
  responded_by UUID,
  responded_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competition_entries_status_check CHECK (status IN ('invited','accepted','declined','withdrawn','removed')),
  UNIQUE (competition_id, team_id)
);
CREATE INDEX idx_competition_entries_competition ON public.competition_entries(competition_id);
CREATE INDEX idx_competition_entries_team ON public.competition_entries(team_id);
CREATE INDEX idx_competition_entries_division ON public.competition_entries(division_id);

CREATE TABLE public.competition_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competition_roles_role_check CHECK (role IN ('owner','admin','referee','scorer')),
  UNIQUE (competition_id, user_id, role)
);
CREATE INDEX idx_competition_roles_user ON public.competition_roles(user_id);
CREATE INDEX idx_competition_roles_competition ON public.competition_roles(competition_id);

CREATE TRIGGER trg_competitions_updated_at BEFORE UPDATE ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_competition_divisions_updated_at BEFORE UPDATE ON public.competition_divisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_competition_entries_updated_at BEFORE UPDATE ON public.competition_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_competition_admin(_user_id UUID, _competition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club UUID;
  _is_role BOOLEAN;
BEGIN
  SELECT organizer_club_id INTO _club FROM public.competitions WHERE id = _competition_id;
  IF _club IS NULL THEN RETURN FALSE; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.competition_roles
    WHERE competition_id = _competition_id
      AND user_id = _user_id
      AND role IN ('owner','admin')
  ) INTO _is_role;
  IF _is_role THEN RETURN TRUE; END IF;

  RETURN COALESCE(public.is_club_admin(_user_id, _club), FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_competition(_user_id UUID, _competition_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = _competition_id
      AND (
        c.visibility = 'public'
        OR public.is_competition_admin(_user_id, _competition_id)
        OR EXISTS (
          SELECT 1
          FROM public.competition_entries ce
          JOIN public.user_roles ur ON ur.team_id = ce.team_id
          WHERE ce.competition_id = c.id AND ur.user_id = _user_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_team_admin_for_entry(_user_id UUID, _team_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE team_id = _team_id
      AND user_id = _user_id
      AND role IN ('team_admin','coach','club_admin')
  );
$$;

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View competitions" ON public.competitions
  FOR SELECT TO authenticated
  USING (public.can_view_competition(auth.uid(), id));

CREATE POLICY "Create competitions" ON public.competitions
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_club_admin(auth.uid(), organizer_club_id));

CREATE POLICY "Update competitions" ON public.competitions
  FOR UPDATE TO authenticated
  USING (public.is_competition_admin(auth.uid(), id));

CREATE POLICY "Delete competitions" ON public.competitions
  FOR DELETE TO authenticated
  USING (public.is_competition_admin(auth.uid(), id));

CREATE POLICY "View divisions" ON public.competition_divisions
  FOR SELECT TO authenticated
  USING (public.can_view_competition(auth.uid(), competition_id));

CREATE POLICY "Manage divisions" ON public.competition_divisions
  FOR ALL TO authenticated
  USING (public.is_competition_admin(auth.uid(), competition_id))
  WITH CHECK (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "View entries" ON public.competition_entries
  FOR SELECT TO authenticated
  USING (
    public.can_view_competition(auth.uid(), competition_id)
    OR public.is_team_admin_for_entry(auth.uid(), team_id)
  );

CREATE POLICY "Admins invite teams" ON public.competition_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "Manage entries" ON public.competition_entries
  FOR UPDATE TO authenticated
  USING (
    public.is_competition_admin(auth.uid(), competition_id)
    OR public.is_team_admin_for_entry(auth.uid(), team_id)
  );

CREATE POLICY "Admins delete entries" ON public.competition_entries
  FOR DELETE TO authenticated
  USING (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "View competition roles" ON public.competition_roles
  FOR SELECT TO authenticated
  USING (public.can_view_competition(auth.uid(), competition_id));

CREATE POLICY "Manage competition roles" ON public.competition_roles
  FOR ALL TO authenticated
  USING (public.is_competition_admin(auth.uid(), competition_id))
  WITH CHECK (public.is_competition_admin(auth.uid(), competition_id));

CREATE OR REPLACE FUNCTION public.create_competition_owner_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.competition_roles (competition_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_competitions_create_owner_role
  AFTER INSERT ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.create_competition_owner_role();