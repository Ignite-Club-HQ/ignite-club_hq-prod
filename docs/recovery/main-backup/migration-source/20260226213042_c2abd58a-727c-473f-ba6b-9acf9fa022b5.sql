
-- Create message_reports table for reporting chat messages
CREATE TABLE public.message_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL,
  message_type TEXT NOT NULL, -- 'team', 'club', 'group', 'direct', 'broadcast'
  reporter_id UUID NOT NULL,
  reason TEXT NOT NULL,
  additional_details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create message reports"
  ON public.message_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can view own message reports"
  ON public.message_reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "App admins can view all message reports"
  ON public.message_reports FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));

CREATE POLICY "App admins can update message reports"
  ON public.message_reports FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));

CREATE TRIGGER update_message_reports_updated_at
  BEFORE UPDATE ON public.message_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
