-- Track which users have viewed each photo in the media gallery
CREATE TABLE public.photo_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (photo_id, user_id)
);

CREATE INDEX idx_photo_views_photo_id ON public.photo_views(photo_id);
CREATE INDEX idx_photo_views_user_id ON public.photo_views(user_id);

ALTER TABLE public.photo_views ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can record their own view
CREATE POLICY "Users can record their own photo views"
ON public.photo_views
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Anyone authenticated can read view rows (so counts are visible to all viewers)
CREATE POLICY "Authenticated users can read photo views"
ON public.photo_views
FOR SELECT
TO authenticated
USING (true);

-- Realtime updates so counts increment live
ALTER TABLE public.photo_views REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_views;