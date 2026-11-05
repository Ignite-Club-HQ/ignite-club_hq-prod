-- HELD DESIGN / NON-MUTATING CHECK ONLY. Not a completed score-privacy transition.
-- Never replay the original score-clearing/trigger replacement migrations.
DO $$ BEGIN
 IF to_regprocedure('public.sync_competition_match_events()') IS NULL
   OR to_regprocedure('public.guard_external_competition_match_edits()') IS NULL THEN
   RAISE EXCEPTION 'Expected fixture/History preservation contracts missing';
 END IF;
END; $$;
-- Required follow-up phases (no phase is automatically authorized):
-- 1. Create private shadow result storage with explicit grants/RLS and exact DTOs.
-- 2. Rehearse deterministic match/event/History reconciliation, including zero/NULL,
--    home/away orientation, divergent sources, tenant-scoped external keys and orphans.
-- 3. Preserve match event IDs and History anchors through swaps/reschedules/deletion.
-- 4. Verify coverage/conflicts and every REST/DTO/stat/report/ladder visibility path.
-- 5. Independently approve exact data transition before nulling any plaintext scores.
-- No hide-value reset, FK rewrite, score UPDATE, trigger drop or privilege sweep here.