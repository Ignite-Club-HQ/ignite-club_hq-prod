
-- Create comment_reports table (mirrors photo_reports structure)
CREATE TABLE public.comment_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID NOT NULL REFERENCES public.photo_comments(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL,
  reason TEXT NOT NULL,
  additional_details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;

-- Users can create reports
CREATE POLICY "Users can create comment reports"
  ON public.comment_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- Users can view their own reports
CREATE POLICY "Users can view own comment reports"
  ON public.comment_reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- App admins can view all reports
CREATE POLICY "App admins can view all comment reports"
  ON public.comment_reports FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));

-- App admins can update reports
CREATE POLICY "App admins can update comment reports"
  ON public.comment_reports FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));

-- Trigger for updated_at
CREATE TRIGGER update_comment_reports_updated_at
  BEFORE UPDATE ON public.comment_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
