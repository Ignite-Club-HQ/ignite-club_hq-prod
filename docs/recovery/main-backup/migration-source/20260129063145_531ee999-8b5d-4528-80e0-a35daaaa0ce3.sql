-- Create photo_reports table to track reported photos
CREATE TABLE public.photo_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  additional_details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for quick lookups
CREATE INDEX idx_photo_reports_photo_id ON public.photo_reports(photo_id);
CREATE INDEX idx_photo_reports_status ON public.photo_reports(status);
CREATE INDEX idx_photo_reports_reporter_id ON public.photo_reports(reporter_id);

-- Enable RLS
ALTER TABLE public.photo_reports ENABLE ROW LEVEL SECURITY;

-- Users can create reports for any photo they can see
CREATE POLICY "Users can create photo reports"
ON public.photo_reports FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = reporter_id);

-- Users can view their own reports
CREATE POLICY "Users can view their own reports"
ON public.photo_reports FOR SELECT
TO authenticated
USING (auth.uid() = reporter_id);

-- App admins can view and manage all reports
CREATE POLICY "App admins can view all reports"
ON public.photo_reports FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'app_admin', NULL, NULL));

CREATE POLICY "App admins can update reports"
ON public.photo_reports FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'app_admin', NULL, NULL));

-- Trigger to update updated_at
CREATE TRIGGER update_photo_reports_updated_at
BEFORE UPDATE ON public.photo_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();