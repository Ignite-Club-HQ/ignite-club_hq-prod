-- Add user_id column for adult self-enrolment
ALTER TABLE public.class_enrolments 
  ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Make child_id nullable (was NOT NULL)
ALTER TABLE public.class_enrolments 
  ALTER COLUMN child_id DROP NOT NULL;

-- Add validation trigger: exactly one of child_id or user_id must be set
CREATE OR REPLACE FUNCTION public.validate_class_enrolment_participant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.child_id IS NULL AND NEW.user_id IS NULL) THEN
    RAISE EXCEPTION 'Either child_id or user_id must be set';
  END IF;
  IF (NEW.child_id IS NOT NULL AND NEW.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Only one of child_id or user_id can be set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_class_enrolment_participant
  BEFORE INSERT OR UPDATE ON public.class_enrolments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_class_enrolment_participant();

-- Add index for user_id lookups
CREATE INDEX idx_class_enrolments_user ON public.class_enrolments(user_id);

-- Add unique constraint to prevent duplicate adult enrolments
CREATE UNIQUE INDEX idx_class_enrolments_user_team_term 
  ON public.class_enrolments(user_id, team_id, term_id) 
  WHERE user_id IS NOT NULL AND status != 'withdrawn';

-- Update RLS: Adults can view their own enrolments
CREATE POLICY "Users can view own enrolments"
  ON public.class_enrolments FOR SELECT
  USING (auth.uid() = user_id);

-- Adults can enrol themselves
CREATE POLICY "Users can enrol themselves"
  ON public.class_enrolments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Adults can update their own enrolments (withdraw)
CREATE POLICY "Users can update own enrolments"
  ON public.class_enrolments FOR UPDATE
  USING (auth.uid() = user_id);

-- Update the existing guardian policies to handle nullable child_id
DROP POLICY IF EXISTS "Guardians can view child enrolments" ON public.class_enrolments;
CREATE POLICY "Guardians can view child enrolments"
  ON public.class_enrolments FOR SELECT
  USING (child_id IS NOT NULL AND public.is_child_guardian(auth.uid(), child_id));

DROP POLICY IF EXISTS "Guardians can enrol children" ON public.class_enrolments;
CREATE POLICY "Guardians can enrol children"
  ON public.class_enrolments FOR INSERT
  WITH CHECK (child_id IS NOT NULL AND public.is_child_guardian(auth.uid(), child_id));

DROP POLICY IF EXISTS "Guardians can update own child enrolments" ON public.class_enrolments;
CREATE POLICY "Guardians can update own child enrolments"
  ON public.class_enrolments FOR UPDATE
  USING (child_id IS NOT NULL AND public.is_child_guardian(auth.uid(), child_id));