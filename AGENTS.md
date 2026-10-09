# Architecture rules

- Preserve imported competition finals labels in the existing match notes field and derive fixture badges with the shared finals-label helper; this reuses generated-finals metadata without schema changes.- Read-only competition fixture visibility (competition Owner/Admin, organising-club league admin) is decided by DB `is_league_admin_for_competition` and client `src/lib/competitionViewerScope.ts`; keep both in sync so Schedule, Next Up and event detail agree.
