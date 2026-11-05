-- Persistent team join tokens
CREATE TABLE public.team_join_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  default_role TEXT NOT NULL DEFAULT 'parent',
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_join_tokens_team ON public.team_join_tokens(team_id);
CREATE INDEX idx_team_join_tokens_token ON public.team_join_tokens(token);

ALTER TABLE public.team_join_tokens ENABLE ROW LEVEL SECURITY;

-- Helper: is this user an admin/coach/club_admin/app_admin for the team's club
CREATE OR REPLACE FUNCTION public.can_manage_team_join_token(_team_id UUID, _club_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('app_admin', 'club_admin', 'team_admin', 'coach')
      AND (
        ur.team_id = _team_id
        OR (ur.club_id = _club_id AND ur.role IN ('app_admin', 'club_admin'))
      )
  );
$$;

CREATE POLICY "Team managers can view join tokens"
ON public.team_join_tokens
FOR SELECT
TO authenticated
USING (public.can_manage_team_join_token(team_id, club_id, auth.uid()));

CREATE POLICY "Team managers can create join tokens"
ON public.team_join_tokens
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.can_manage_team_join_token(team_id, club_id, auth.uid())
);

CREATE POLICY "Team managers can update join tokens"
ON public.team_join_tokens
FOR UPDATE
TO authenticated
USING (public.can_manage_team_join_token(team_id, club_id, auth.uid()))
WITH CHECK (public.can_manage_team_join_token(team_id, club_id, auth.uid()));

CREATE POLICY "Team managers can delete join tokens"
ON public.team_join_tokens
FOR DELETE
TO authenticated
USING (public.can_manage_team_join_token(team_id, club_id, auth.uid()));

-- Updated-at trigger
CREATE TRIGGER update_team_join_tokens_updated_at
BEFORE UPDATE ON public.team_join_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();