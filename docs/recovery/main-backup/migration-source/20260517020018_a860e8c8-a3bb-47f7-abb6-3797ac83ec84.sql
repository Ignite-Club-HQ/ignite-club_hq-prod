-- Phase 1 — Org & Competition foundation (retry)

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS parent_org_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL;

ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_kind_check;
ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_kind_check
  CHECK (kind IN ('full', 'shell', 'association'));

CREATE INDEX IF NOT EXISTS idx_clubs_kind ON public.clubs(kind);
CREATE INDEX IF NOT EXISTS idx_clubs_parent_org_id ON public.clubs(parent_org_id)
  WHERE parent_org_id IS NOT NULL;

WITH single_team_clubs AS (
  SELECT c.id AS club_id,
         (array_agg(t.id))[1] AS team_id,
         COUNT(*) AS team_count
  FROM public.clubs c
  JOIN public.teams t ON t.club_id = c.id
  WHERE c.deleted_at IS NULL
  GROUP BY c.id
  HAVING COUNT(*) = 1
),
shell_candidates AS (
  SELECT c.id
  FROM public.clubs c
  JOIN single_team_clubs s ON s.club_id = c.id
  JOIN public.teams t ON t.id = s.team_id
  WHERE c.logo_url IS NULL
    AND (c.description IS NULL OR length(trim(c.description)) = 0)
    AND c.city IS NULL
    AND c.sponsorship_pitch IS NULL
    AND c.primary_sponsor_id IS NULL
    AND c.listed_on_marketplace = false
    AND c.is_pro = false
    AND c.stripe_connect_account_id IS NULL
    AND c.subscription_status = 'FREE'
    AND (
      lower(c.name) = lower(t.name)
      OR position(lower(t.name) in lower(c.name)) > 0
      OR position(lower(c.name) in lower(t.name)) > 0
    )
)
UPDATE public.clubs
SET kind = 'shell'
WHERE id IN (SELECT id FROM shell_candidates)
  AND kind = 'full';

COMMENT ON COLUMN public.clubs.kind IS
  '''full'' = a real club; ''shell'' = auto-created stub for a standalone/social team (hidden from club discovery surfaces); ''association'' = parent org wrapping other clubs via parent_org_id.';
COMMENT ON COLUMN public.clubs.parent_org_id IS
  'For child clubs of an association, points to the parent association club id.';