
-- Attendance tracking for class sessions
CREATE TABLE public.class_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id UUID NOT NULL REFERENCES public.terms(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late')),
  marked_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (term_id, team_id, session_date, child_id),
  UNIQUE (term_id, team_id, session_date, user_id)
);

-- Enable RLS
ALTER TABLE public.class_attendance ENABLE ROW LEVEL SECURITY;

-- Admins, coaches, and club admins can manage attendance
CREATE POLICY "Admins can manage attendance"
ON public.class_attendance
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.teams t ON t.id = class_attendance.team_id
    WHERE ur.user_id = auth.uid()
    AND (
      (ur.role IN ('club_admin', 'app_admin') AND ur.club_id = t.club_id)
      OR (ur.role IN ('team_admin', 'coach') AND ur.team_id = class_attendance.team_id)
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.teams t ON t.id = class_attendance.team_id
    WHERE ur.user_id = auth.uid()
    AND (
      (ur.role IN ('club_admin', 'app_admin') AND ur.club_id = t.club_id)
      OR (ur.role IN ('team_admin', 'coach') AND ur.team_id = class_attendance.team_id)
    )
  )
);

-- Parents can view their own children's attendance
CREATE POLICY "Parents can view own children attendance"
ON public.class_attendance
FOR SELECT
TO authenticated
USING (
  child_id IN (SELECT id FROM public.children WHERE parent_id = auth.uid())
  OR user_id = auth.uid()
);
