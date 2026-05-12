-- Per-mini-league admin scoping (additive to existing club-wide league_admin role)

CREATE TABLE public.mini_league_admins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mini_league_id UUID NOT NULL REFERENCES public.mini_leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  granted_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (mini_league_id, user_id)
);

CREATE INDEX idx_mini_league_admins_user ON public.mini_league_admins(user_id);
CREATE INDEX idx_mini_league_admins_league ON public.mini_league_admins(mini_league_id);

ALTER TABLE public.mini_league_admins ENABLE ROW LEVEL SECURITY;

-- View: anyone signed in who shares the club with the mini-league
CREATE POLICY "Club members can view mini-league admins"
ON public.mini_league_admins
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.mini_leagues ml
    JOIN public.user_roles ur ON ur.club_id = ml.club_id
    WHERE ml.id = mini_league_admins.mini_league_id
      AND ur.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'app_admin'
  )
);

-- Insert: club admins of the league's club, or app admins
CREATE POLICY "Club admins can grant mini-league admin"
ON public.mini_league_admins
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.mini_leagues ml
    WHERE ml.id = mini_league_admins.mini_league_id
      AND public.is_club_admin(auth.uid(), ml.club_id)
  )
);

-- Delete: same as insert
CREATE POLICY "Club admins can revoke mini-league admin"
ON public.mini_league_admins
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.mini_leagues ml
    WHERE ml.id = mini_league_admins.mini_league_id
      AND public.is_club_admin(auth.uid(), ml.club_id)
  )
);

-- Extend the existing `is_league_admin` central check to also honour
-- per-league grants from the new table. Every call site (RLS policies,
-- triggers, edge functions) inherits per-league scoping for free.
CREATE OR REPLACE FUNCTION public.is_league_admin(p_user_id uuid, p_mini_league_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Club-wide league_admin / club_admin / app_admin (existing behaviour)
  IF EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ur.user_id = p_user_id
      AND ml.id = p_mini_league_id
      AND ur.role IN ('league_admin', 'club_admin', 'app_admin')
  ) THEN
    RETURN TRUE;
  END IF;

  -- Per-mini-league grant (new)
  IF EXISTS (
    SELECT 1 FROM mini_league_admins mla
    WHERE mla.user_id = p_user_id
      AND mla.mini_league_id = p_mini_league_id
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;