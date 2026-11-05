-- Phase 1: Default Training RSVP

-- 1. rsvps.source column
ALTER TABLE public.rsvps
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user';

ALTER TABLE public.rsvps
  DROP CONSTRAINT IF EXISTS rsvps_source_check;
ALTER TABLE public.rsvps
  ADD CONSTRAINT rsvps_source_check CHECK (source IN ('user','default','coach'));

CREATE INDEX IF NOT EXISTS rsvps_event_source_idx ON public.rsvps (event_id, source);

-- 2. child_training_defaults table
CREATE TABLE IF NOT EXISTS public.child_training_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.children(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  default_status text NOT NULL CHECK (default_status IN ('going','not_going')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT child_or_user_required CHECK (
    (child_id IS NOT NULL AND user_id IS NULL) OR
    (child_id IS NULL AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS child_training_defaults_team_child_uidx
  ON public.child_training_defaults (team_id, child_id)
  WHERE child_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS child_training_defaults_team_user_uidx
  ON public.child_training_defaults (team_id, user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS child_training_defaults_team_idx
  ON public.child_training_defaults (team_id) WHERE deleted_at IS NULL;

ALTER TABLE public.child_training_defaults ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_child_training_defaults_updated ON public.child_training_defaults;
CREATE TRIGGER trg_child_training_defaults_updated
  BEFORE UPDATE ON public.child_training_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RLS policies
DROP POLICY IF EXISTS "ctd_select" ON public.child_training_defaults;
CREATE POLICY "ctd_select" ON public.child_training_defaults
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    (child_id IS NOT NULL AND public.is_parent_of_child(auth.uid(), child_id))
    OR (user_id IS NOT NULL AND user_id = auth.uid())
    OR public.can_manage_team_roster(auth.uid(), team_id)
    OR public.has_role(auth.uid(), 'club_admin'::public.app_role, (SELECT club_id FROM public.teams WHERE id = team_id), NULL)
  )
);

DROP POLICY IF EXISTS "ctd_insert" ON public.child_training_defaults;
CREATE POLICY "ctd_insert" ON public.child_training_defaults
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid() AND (
    (child_id IS NOT NULL AND public.is_parent_of_child(auth.uid(), child_id))
    OR (user_id IS NOT NULL AND user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "ctd_update" ON public.child_training_defaults;
CREATE POLICY "ctd_update" ON public.child_training_defaults
FOR UPDATE TO authenticated
USING (
  (child_id IS NOT NULL AND public.is_parent_of_child(auth.uid(), child_id))
  OR (user_id IS NOT NULL AND user_id = auth.uid())
);

DROP POLICY IF EXISTS "ctd_delete" ON public.child_training_defaults;
CREATE POLICY "ctd_delete" ON public.child_training_defaults
FOR DELETE TO authenticated
USING (
  (child_id IS NOT NULL AND public.is_parent_of_child(auth.uid(), child_id))
  OR (user_id IS NOT NULL AND user_id = auth.uid())
);

-- 4. Apply defaults when a new training event is created
CREATE OR REPLACE FUNCTION public.apply_training_defaults_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type::text <> 'training' OR NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.is_cancelled THEN
    RETURN NEW;
  END IF;

  -- Insert child defaults
  INSERT INTO public.rsvps (event_id, child_id, status, source)
  SELECT NEW.id, d.child_id, d.default_status::rsvp_status, 'default'
  FROM public.child_training_defaults d
  WHERE d.team_id = NEW.team_id
    AND d.child_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND d.default_status = 'going'
    AND NOT EXISTS (
      SELECT 1 FROM public.rsvps r
      WHERE r.event_id = NEW.id AND r.child_id = d.child_id
    );

  -- Insert adult/user defaults
  INSERT INTO public.rsvps (event_id, user_id, status, source)
  SELECT NEW.id, d.user_id, d.default_status::rsvp_status, 'default'
  FROM public.child_training_defaults d
  WHERE d.team_id = NEW.team_id
    AND d.user_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND d.default_status = 'going'
    AND NOT EXISTS (
      SELECT 1 FROM public.rsvps r
      WHERE r.event_id = NEW.id AND r.user_id = d.user_id AND r.child_id IS NULL
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_training_defaults_on_event ON public.events;
CREATE TRIGGER trg_apply_training_defaults_on_event
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.apply_training_defaults_on_event();

-- 5. When a default is created or flipped to 'going', forward-apply to future trainings
CREATE OR REPLACE FUNCTION public.apply_training_default_forward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.default_status <> 'going' THEN
    RETURN NEW;
  END IF;

  IF NEW.child_id IS NOT NULL THEN
    INSERT INTO public.rsvps (event_id, child_id, status, source)
    SELECT e.id, NEW.child_id, 'going'::rsvp_status, 'default'
    FROM public.events e
    WHERE e.team_id = NEW.team_id
      AND e.type::text = 'training'
      AND e.is_cancelled = false
      AND e.event_date > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.rsvps r
        WHERE r.event_id = e.id AND r.child_id = NEW.child_id
      );
  ELSIF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.rsvps (event_id, user_id, status, source)
    SELECT e.id, NEW.user_id, 'going'::rsvp_status, 'default'
    FROM public.events e
    WHERE e.team_id = NEW.team_id
      AND e.type::text = 'training'
      AND e.is_cancelled = false
      AND e.event_date > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.rsvps r
        WHERE r.event_id = e.id AND r.user_id = NEW.user_id AND r.child_id IS NULL
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_training_default_forward ON public.child_training_defaults;
CREATE TRIGGER trg_apply_training_default_forward
  AFTER INSERT OR UPDATE OF default_status, deleted_at ON public.child_training_defaults
  FOR EACH ROW EXECUTE FUNCTION public.apply_training_default_forward();