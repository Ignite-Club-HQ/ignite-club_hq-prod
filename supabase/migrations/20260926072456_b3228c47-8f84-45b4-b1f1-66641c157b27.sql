ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS competition_id uuid NULL REFERENCES public.competitions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_photos_competition_id ON public.photos(competition_id);

CREATE OR REPLACE FUNCTION public.is_competition_member(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND _competition_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.competition_roles cr WHERE cr.competition_id = _competition_id AND cr.user_id = _user_id)
    OR public.has_role(_user_id, 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    OR EXISTS (SELECT 1 FROM public.competition_entries ce
               WHERE ce.competition_id = _competition_id AND ce.status = 'accepted'
                 AND public.is_team_member(_user_id, ce.team_id))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_competition_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_competition_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_competition_media(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.competition_roles cr WHERE cr.competition_id = _competition_id AND cr.user_id = _user_id AND cr.role IN ('admin','owner'))
    OR public.has_role(_user_id, 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    OR EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = _competition_id
               AND c.organizer_club_id IS NOT NULL
               AND public.has_role(_user_id, 'club_admin'::app_role, c.organizer_club_id, NULL::uuid))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_manage_competition_media(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_competition_media(uuid, uuid) TO authenticated, service_role;

CREATE POLICY "Competition members can view competition media" ON public.photos
  FOR SELECT TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_member((SELECT auth.uid()), competition_id));

CREATE POLICY "Competition members can upload competition media" ON public.photos
  FOR INSERT TO authenticated
  WITH CHECK (competition_id IS NOT NULL AND team_id IS NULL AND club_id IS NULL AND mini_league_id IS NULL
    AND uploader_id = (SELECT auth.uid())
    AND public.is_competition_member((SELECT auth.uid()), competition_id));

CREATE POLICY "Uploaders and admins can update competition media" ON public.photos
  FOR UPDATE TO authenticated
  USING (competition_id IS NOT NULL AND (uploader_id = (SELECT auth.uid()) OR public.can_manage_competition_media((SELECT auth.uid()), competition_id)))
  WITH CHECK (competition_id IS NOT NULL);

CREATE POLICY "Uploaders and admins can delete competition media" ON public.photos
  FOR DELETE TO authenticated
  USING (competition_id IS NOT NULL AND (uploader_id = (SELECT auth.uid()) OR public.can_manage_competition_media((SELECT auth.uid()), competition_id)));