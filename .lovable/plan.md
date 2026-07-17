# Archive Basketball & Netball Code

Goal: remove ~14,850 LOC of unused sport code from the app bundle while keeping git history intact and giving us a one-command rollback path.

## Rollback strategy (built in first, before touching anything)

1. **Single commit / single PR** — every file move and edit lands in one atomic change. Revert = one click in GitHub or one Lovable history revert.
2. **`git mv` (not delete + recreate)** — preserves file history so `git log --follow archive/sports/...` still shows the full past.
3. **Tag before, tag after** — `pre-sport-archive` and `post-sport-archive` tags for instant `git reset` if needed.
4. **Archive lives in-repo** at `archive/sports/` with a `README.md` documenting exact restore steps (which files to `git mv` back, which imports to re-add).

## Scope of changes

**Move to `archive/sports/`** (invisible to Vite/TS, ~14,850 LOC):
- `src/components/basketball/` → `archive/sports/components/basketball/`
- `src/components/netball/` → `archive/sports/components/netball/`
- `src/hooks/useBasketball*.ts`, `useNetballGameSync.ts`, `useCourtBoardDefaults.ts`, `useCourtSpectator.ts` (+ tests)
- `src/components/scoreboard/BasketballSpectatorView.tsx`, `NetballSpectatorView.tsx`, `CentrePassIndicator.tsx`, `TimeoutsPanel.tsx`, `FoulFatigueWatchlist.tsx`, `QuarterAutoSubControlPanel.tsx`, `SubConfirmDialog.tsx`, `CuesToggle.tsx`, `GameSummaryDialog.tsx` (court-specific ones only — keep `SoccerSpectatorView.tsx`)
- `src/components/home/CourtBoardResumeCard.tsx`

**Edit in place** (~46 shared files) to remove basketball/netball branches:
- `src/lib/sportDetection.ts` — force `'football'` return, keep `Sport` type union intact for DB compatibility
- `src/lib/sportScoreConfig.ts`, `sportEmojis.ts`, `gameCues.ts`, `periodTypes.ts`, `gameSyncSignature.ts` — drop non-football branches
- `src/hooks/useActiveGameSync.ts`, `useSaveGameResult.ts`, `useAutoSubNotify.ts` — remove court-sport code paths
- `src/components/chat/BoardPickerSheet.tsx`, `BoardViewerDialog.tsx`, `BoardLinkCard.tsx`, `ChatImageInput.tsx` — football-only board sharing
- `src/components/scoreboard/spectatorTypes.ts`, `SoccerSpectatorView.tsx` — narrow types
- `src/components/history/TeamGameHistoryTab.tsx`, `ClubRecentGames.tsx` — soccer-only rendering
- `src/pages/*.tsx` (`HomePage`, `TeamDetailPage`, `ClubDetailPage`, `EventDetailPage`, `AdminActiveGamesPage`, `WatchLiveTeamPage`) — remove court-board resume / spectator hooks
- `src/components/NextUpCarousel.tsx`, `src/components/pitch/GameFinishedDialog.tsx`, `pitchBoardNotifyFlags.ts` — football-only
- `src/lib/syncWriteRateMonitor.ts` — drop court-game monitoring

**Do NOT touch:**
- DB schema — `clubs.sport`, `competitions.sport`, `game_results.sport` all stay. Clubs stay tagged with their sport for branding.
- The `Sport` type union stays as `'football' | 'basketball' | 'netball' | ...` so DB reads don't crash on legacy values.

## Testing checklist (rigorous)

Run in this order — each gate must pass before the next:

1. **Static** — `tsgo` typecheck clean, `bun run build` clean, `knip` shows no new orphans.
2. **Unit tests** — `bunx vitest run` full suite green.
3. **Grep audit** — `rg "basketball|netball" src/` returns only intentional references (Sport type union, DB value tolerance).
4. **Playwright smoke** on running dev server, screenshotted at each step:
   - Auth → home loads
   - Open a football team → schedule → event detail
   - Create a football event
   - Open pitch board on a football event → verify it renders
   - Open chat → attach a board link → verify picker shows only football
   - Open a club that has `sport = 'basketball'` in DB → verify it loads without crashing (just no board features)
   - Inbox → open a chat thread
5. **Console/network check** during smoke — no red errors, no 500s.
6. **Bundle size diff** — capture `dist/` size before/after, expect ~15% JS reduction.

## Rollout

1. Do all the work on a feature branch, not main.
2. Deploy the branch to Lovable preview.
3. Manual smoke on preview device (Android + iOS Codemagic debug build).
4. Only after both native builds pass smoke → merge → prod promotion.

## Rollback triggers

If any of these hit in the 48h after merge:
- Sentry/console errors mentioning removed modules
- User report of missing feature
- Build failure on either native platform

→ Execute: `git revert <archive-commit-sha>` → push → done. All archived files are already in `archive/sports/` so no restore needed, just move back with `git mv` when re-enabling.

## Estimated effort

- Coding: 2-3 hours
- Testing: 1-2 hours
- Total: half a day, single PR
