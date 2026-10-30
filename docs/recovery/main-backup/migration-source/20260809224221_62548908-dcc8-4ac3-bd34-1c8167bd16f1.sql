CREATE TABLE public.club_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  url TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'link',
  open_mode TEXT NOT NULL DEFAULT 'browser',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX club_links_club_idx ON public.club_links (club_id, is_active, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_links TO authenticated;
GRANT ALL ON public.club_links TO service_role;

ALTER TABLE public.club_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Club members can view active club links"
ON public.club_links FOR SELECT TO authenticated
USING (
  is_active
  AND (
    public.is_club_member(auth.uid(), club_id)
    OR public.is_club_admin(club_id, auth.uid())
    OR public.has_role(auth.uid(), 'app_admin'::app_role)
  )
);

CREATE POLICY "Club admins can view all club links"
ON public.club_links FOR SELECT TO authenticated
USING (
  public.is_club_admin(club_id, auth.uid())
  OR public.has_role(auth.uid(), 'app_admin'::app_role)
);

CREATE POLICY "Club admins can insert club links"
ON public.club_links FOR INSERT TO authenticated
WITH CHECK (
  public.is_club_admin(club_id, auth.uid())
  OR public.has_role(auth.uid(), 'app_admin'::app_role)
);

CREATE POLICY "Club admins can update club links"
ON public.club_links FOR UPDATE TO authenticated
USING (
  public.is_club_admin(club_id, auth.uid())
  OR public.has_role(auth.uid(), 'app_admin'::app_role)
)
WITH CHECK (
  public.is_club_admin(club_id, auth.uid())
  OR public.has_role(auth.uid(), 'app_admin'::app_role)
);

CREATE POLICY "Club admins can delete club links"
ON public.club_links FOR DELETE TO authenticated
USING (
  public.is_club_admin(club_id, auth.uid())
  OR public.has_role(auth.uid(), 'app_admin'::app_role)
);

CREATE TRIGGER club_links_set_updated_at
BEFORE UPDATE ON public.club_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();