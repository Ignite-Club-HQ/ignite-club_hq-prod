CREATE TABLE public.score_review_ai_access (id text PRIMARY KEY, blocked boolean NOT NULL DEFAULT false, status integer, message text, updated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.score_review_ai_access TO service_role;
REVOKE ALL ON public.score_review_ai_access FROM anon, authenticated;
ALTER TABLE public.score_review_ai_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manages score review AI status" ON public.score_review_ai_access FOR ALL TO service_role USING (true) WITH CHECK (true);