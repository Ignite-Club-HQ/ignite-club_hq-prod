-- Phase 3 — holiday pause + soft-pause + rollover scaffolding

CREATE TABLE IF NOT EXISTS public.team_training_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  label text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS team_training_pauses_team_window_idx
  ON public.team_training_pauses (team_id, starts_at, ends_at);

ALTER TABLE public.team_training_pauses ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_team_training_pauses_updated ON public.team_training_pauses;
CREATE TRIGGER trg_team_training_pauses_updated
  BEFORE UPDATE ON public.team_training_pauses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "ttp_select" ON public.team_training_pauses;
CREATE POLICY "ttp_select" ON public.team_training_pauses
FOR SELECT TO authenticated
USING (
  public.is_team_member(auth.uid(), team_id)
  OR public.can_manage_team_roster(auth.uid(), team_id)
  OR public.has_role(auth.uid(), 'club_admin'::public.app_role,
                     (SELECT club_id FROM public.teams WHERE id = team_id), NULL)
);

DROP POLICY IF EXISTS "ttp_modify" ON public.team_training_pauses;
CREATE POLICY "ttp_modify" ON public.team_training_pauses
FOR ALL TO authenticated
USING (
  public.can_manage_team_roster(auth.uid(), team_id)
  OR public.has_role(auth.uid(), 'club_admin'::public.app_role,
                     (SELECT club_id FROM public.teams WHERE id = team_id), NULL)
)
WITH CHECK (
  public.can_manage_team_roster(auth.uid(), team_id)
  OR public.has_role(auth.uid(), 'club_admin'::public.app_role,
                     (SELECT club_id FROM public.teams WHERE id = team_id), NULL)
);

ALTER TABLE public.child_training_defaults
  ADD COLUMN IF NOT EXISTS last_confirmation_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_paused_reason text;

CREATE TABLE IF NOT EXISTS public.default_rollover_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  default_id uuid NOT NULL REFERENCES public.child_training_defaults(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS default_rollover_log_default_idx
  ON public.default_rollover_log (default_id, notified_at DESC);
ALTER TABLE public.default_rollover_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.apply_training_defaults_on_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type::text <> 'training' OR NEW.team_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.is_cancelled THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_training_pauses p
    WHERE p.team_id = NEW.team_id
      AND NEW.event_date >= p.starts_at
      AND NEW.event_date <  p.ends_at
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.rsvps (event_id, child_id, status, source)
  SELECT NEW.id, d.child_id, d.default_status::rsvp_status, 'default'
  FROM public.child_training_defaults d
  WHERE d.team_id = NEW.team_id
    AND d.child_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND d.auto_paused_at IS NULL
    AND d.default_status = 'going'
    AND NOT EXISTS (
      SELECT 1 FROM public.rsvps r
      WHERE r.event_id = NEW.id AND r.child_id = d.child_id
    );

  INSERT INTO public.rsvps (event_id, user_id, status, source)
  SELECT NEW.id, d.user_id, d.default_status::rsvp_status, 'default'
  FROM public.child_training_defaults d
  WHERE d.team_id = NEW.team_id
    AND d.user_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND d.auto_paused_at IS NULL
    AND d.default_status = 'going'
    AND NOT EXISTS (
      SELECT 1 FROM public.rsvps r
      WHERE r.event_id = NEW.id AND r.user_id = d.user_id AND r.child_id IS NULL
    );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_training_default_forward()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL
     OR NEW.auto_paused_at IS NOT NULL
     OR NEW.default_status <> 'going' THEN
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
        SELECT 1 FROM public.team_training_pauses p
        WHERE p.team_id = NEW.team_id
          AND e.event_date >= p.starts_at AND e.event_date < p.ends_at
      )
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
        SELECT 1 FROM public.team_training_pauses p
        WHERE p.team_id = NEW.team_id
          AND e.event_date >= p.starts_at AND e.event_date < p.ends_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.rsvps r
        WHERE r.event_id = e.id AND r.user_id = NEW.user_id AND r.child_id IS NULL
      );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_training_default_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid; v_type text;
BEGIN
  IF NEW.source <> 'user' THEN RETURN NEW; END IF;

  SELECT e.team_id, e.type::text INTO v_team, v_type
  FROM public.events e WHERE e.id = NEW.event_id;

  IF v_type <> 'training' OR v_team IS NULL THEN RETURN NEW; END IF;

  IF NEW.child_id IS NOT NULL THEN
    UPDATE public.child_training_defaults
       SET last_confirmation_at = now(),
           auto_paused_at = NULL,
           auto_paused_reason = NULL
     WHERE team_id = v_team AND child_id = NEW.child_id AND deleted_at IS NULL;
  ELSIF NEW.user_id IS NOT NULL THEN
    UPDATE public.child_training_defaults
       SET last_confirmation_at = now(),
           auto_paused_at = NULL,
           auto_paused_reason = NULL
     WHERE team_id = v_team AND user_id = NEW.user_id AND deleted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_training_default_confirmation ON public.rsvps;
CREATE TRIGGER trg_touch_training_default_confirmation
  AFTER INSERT OR UPDATE OF status, source ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.touch_training_default_confirmation();