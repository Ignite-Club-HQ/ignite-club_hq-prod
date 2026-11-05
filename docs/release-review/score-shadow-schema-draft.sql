-- LOCAL REHEARSAL DESIGN ONLY. No backfill, plaintext clearing, existing policies,
-- fixture triggers, History references or public read APIs are changed.
-- No FK cascade: this shadow record must survive fixture deletion for reconciliation.
CREATE TABLE public.release_score_shadow (
 competition_id uuid NOT NULL,
 match_id uuid NOT NULL,
 home_score integer CHECK(home_score IS NULL OR home_score>=0),
 away_score integer CHECK(away_score IS NULL OR away_score>=0),
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 reconciliation_status text NOT NULL CHECK(reconciliation_status IN('empty','partial','consistent','conflict')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(competition_id,match_id)
);
GRANT ALL ON public.release_score_shadow TO service_role;
REVOKE ALL ON public.release_score_shadow FROM PUBLIC,anon,authenticated;
ALTER TABLE public.release_score_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY release_score_shadow_service ON public.release_score_shadow FOR ALL TO service_role USING(true) WITH CHECK(true);
-- Application read DTOs/score privacy not implemented by installing this table.
-- Existing scores remain authoritative until separately reviewed target transition.