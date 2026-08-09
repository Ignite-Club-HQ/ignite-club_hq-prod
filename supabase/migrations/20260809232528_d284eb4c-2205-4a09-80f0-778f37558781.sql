DROP POLICY IF EXISTS "Club admins can insert club links" ON public.club_links;
DROP POLICY IF EXISTS "Club admins can update club links" ON public.club_links;
DROP POLICY IF EXISTS "Club admins can delete club links" ON public.club_links;
DROP POLICY IF EXISTS "Club admins can view all club links" ON public.club_links;
DROP POLICY IF EXISTS "Club members can view active club links" ON public.club_links;

CREATE POLICY "Club admins can insert club links"
  ON public.club_links FOR INSERT TO authenticated
  WITH CHECK (public.is_club_admin_for(club_id));

CREATE POLICY "Club admins can update club links"
  ON public.club_links FOR UPDATE TO authenticated
  USING (public.is_club_admin_for(club_id))
  WITH CHECK (public.is_club_admin_for(club_id));

CREATE POLICY "Club admins can delete club links"
  ON public.club_links FOR DELETE TO authenticated
  USING (public.is_club_admin_for(club_id));

CREATE POLICY "Club admins can view all club links"
  ON public.club_links FOR SELECT TO authenticated
  USING (public.is_club_admin_for(club_id));

CREATE POLICY "Club members can view active club links"
  ON public.club_links FOR SELECT TO authenticated
  USING (is_active AND (public.is_club_member(auth.uid(), club_id) OR public.is_club_admin_for(club_id)));