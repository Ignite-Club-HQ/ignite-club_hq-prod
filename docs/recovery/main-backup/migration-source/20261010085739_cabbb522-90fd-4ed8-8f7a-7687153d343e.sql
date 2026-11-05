CREATE TABLE public.competition_role_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('referee','committee')),
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX competition_role_links_one_per_role ON public.competition_role_links (competition_id, role);

GRANT SELECT, INSERT, DELETE ON public.competition_role_links TO authenticated;
GRANT ALL ON public.competition_role_links TO service_role;
ALTER TABLE public.competition_role_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Competition admins view role links" ON public.competition_role_links
FOR SELECT TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));
CREATE POLICY "Competition admins create role links" ON public.competition_role_links
FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid())
  AND public.is_competition_admin((SELECT auth.uid()), competition_id));
CREATE POLICY "Competition admins revoke role links" ON public.competition_role_links
FOR DELETE TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));

-- Public preview of a link: only competition name + role
CREATE OR REPLACE FUNCTION public.get_competition_role_link_info(p_token text)
RETURNS TABLE(competition_id uuid, competition_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, l.role FROM public.competition_role_links l
  JOIN public.competitions c ON c.id = l.competition_id
  WHERE l.token = p_token
$$;
REVOKE ALL ON FUNCTION public.get_competition_role_link_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competition_role_link_info(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_competition_role_link(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid(); l record; v_club uuid; v_name text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO l FROM public.competition_role_links WHERE token = p_token;
  IF l.id IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT organizer_club_id, name INTO v_club, v_name FROM public.competitions WHERE id = l.competition_id;
  IF NOT EXISTS (SELECT 1 FROM public.competition_roles
     WHERE competition_id = l.competition_id AND user_id = v_me AND role = l.role) THEN
    INSERT INTO public.competition_roles (competition_id, user_id, role) VALUES (l.competition_id, v_me, l.role);
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
    VALUES (v_me, 'membership', 'You have been added as a '
      || CASE l.role WHEN 'referee' THEN 'referee' ELSE 'committee member' END || ' for ' || v_name,
      l.competition_id, v_club);
  END IF;
  RETURN l.competition_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_competition_role_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_competition_role_link(text) TO authenticated;