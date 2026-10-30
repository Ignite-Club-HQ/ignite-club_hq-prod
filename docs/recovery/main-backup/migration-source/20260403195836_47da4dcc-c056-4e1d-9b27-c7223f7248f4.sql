
-- Add soft-delete columns to clubs
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS deleted_by uuid DEFAULT NULL;

-- Add soft-delete columns to teams
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS deleted_by uuid DEFAULT NULL;

-- Index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_clubs_deleted_at ON public.clubs (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_deleted_at ON public.teams (deleted_at) WHERE deleted_at IS NOT NULL;
