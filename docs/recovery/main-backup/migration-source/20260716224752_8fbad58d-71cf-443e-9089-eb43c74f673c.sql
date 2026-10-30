
ALTER TABLE public.home_open_perf ADD COLUMN IF NOT EXISTS primary_club_id uuid;
ALTER TABLE public.schedule_open_perf ADD COLUMN IF NOT EXISTS primary_club_id uuid;
ALTER TABLE public.inbox_open_perf ADD COLUMN IF NOT EXISTS primary_club_id uuid;

CREATE INDEX IF NOT EXISTS idx_home_open_perf_primary_club ON public.home_open_perf(primary_club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_open_perf_primary_club ON public.schedule_open_perf(primary_club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_open_perf_primary_club ON public.inbox_open_perf(primary_club_id, created_at DESC);
