
DROP POLICY IF EXISTS "Anyone can record EOI form view" ON public.eoi_form_views;
CREATE POLICY "Anyone can record EOI form view"
ON public.eoi_form_views FOR INSERT TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.seasons s
    WHERE s.id = season_id
      AND s.club_id = eoi_form_views.club_id
      AND s.eoi_enabled = true
  )
);
