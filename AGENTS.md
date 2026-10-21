# Architecture rules

- Poll voter lists use the shared PollVotersDialog with existing readable poll votes and the profile cache; viewing results never writes votes or broadens chat permissions.

- Codemagic app workflows install with `npm ci` using the committed lockfile; never delete or regenerate it during builds, so dependency versions remain reproducible.

- Preserve imported competition finals labels in the existing match notes field and derive fixture badges with the shared finals-label helper; this reuses generated-finals metadata without schema changes.- Read-only competition fixture visibility (competition Owner/Admin, organising-club league admin) is decided by DB `is_league_admin_for_competition` and client `src/lib/competitionViewerScope.ts`; keep both in sync so Schedule, Next Up and event detail agree.
- Referee/committee join links are checked and accepted only through the server-side link status and accept functions, and the join page sits behind the same native-app gate as team join links; the app never assigns competition roles itself.
