
-- Add class mode flag to clubs
ALTER TABLE public.clubs ADD COLUMN class_mode_enabled boolean NOT NULL DEFAULT false;

-- Add class scheduling fields to teams
ALTER TABLE public.teams ADD COLUMN class_capacity integer;
ALTER TABLE public.teams ADD COLUMN class_day text;
ALTER TABLE public.teams ADD COLUMN class_time time;
ALTER TABLE public.teams ADD COLUMN class_duration_minutes integer;

-- Create terms table
CREATE TABLE public.terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Club members can view terms"
  ON public.terms FOR SELECT
  USING (public.is_club_member(auth.uid(), club_id));

CREATE POLICY "Club admins can manage terms"
  ON public.terms FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND club_id = terms.club_id
    AND role IN ('club_admin', 'app_admin')
  ));

CREATE TRIGGER update_terms_updated_at
  BEFORE UPDATE ON public.terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create enrolment status enum
CREATE TYPE public.enrolment_status AS ENUM ('enrolled', 'waitlisted', 'withdrawn');

-- Create class enrolments table
CREATE TABLE public.class_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.terms(id) ON DELETE CASCADE,
  status public.enrolment_status NOT NULL DEFAULT 'enrolled',
  waitlist_position integer,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(child_id, team_id, term_id)
);

ALTER TABLE public.class_enrolments ENABLE ROW LEVEL SECURITY;

-- Parents/guardians can view their children's enrolments
CREATE POLICY "Guardians can view child enrolments"
  ON public.class_enrolments FOR SELECT
  USING (public.is_child_guardian(auth.uid(), child_id));

-- Guardians can enrol their children
CREATE POLICY "Guardians can enrol children"
  ON public.class_enrolments FOR INSERT
  WITH CHECK (public.is_child_guardian(auth.uid(), child_id));

-- Guardians can withdraw their children
CREATE POLICY "Guardians can update own child enrolments"
  ON public.class_enrolments FOR UPDATE
  USING (public.is_child_guardian(auth.uid(), child_id));

-- Admins/coaches can manage all enrolments for their teams
CREATE POLICY "Team admins can manage enrolments"
  ON public.class_enrolments FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND (
      (ur.team_id = class_enrolments.team_id AND ur.role IN ('team_admin', 'coach'))
      OR (ur.club_id IN (SELECT t.club_id FROM public.teams t WHERE t.id = class_enrolments.team_id) AND ur.role IN ('club_admin', 'app_admin'))
    )
  ));

CREATE TRIGGER update_class_enrolments_updated_at
  BEFORE UPDATE ON public.class_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_class_enrolments_team_term ON public.class_enrolments(team_id, term_id);
CREATE INDEX idx_class_enrolments_child ON public.class_enrolments(child_id);
CREATE INDEX idx_terms_club ON public.terms(club_id);
