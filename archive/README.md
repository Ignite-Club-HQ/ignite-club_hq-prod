# Archived Sport Code

This directory holds code that is **not compiled into the production app**.
Vite and TypeScript only scan `src/`, so nothing under `archive/` ships to
users or affects bundle size.

## What's here

Basketball and netball game-board code, court spectator hooks/pages, and the
`WatchLiveTeamPage` route. Removed on 2026-07-17 because no user had ever run
a court game in production (`game_results` had 0 non-soccer rows) and the code
represented ~17.3k LOC of dead weight in the app bundle.

```
archive/sports/
├── components/
│   ├── basketball/           (21 files) — full basketball board suite
│   ├── netball/              (27 files) — full netball board suite
│   ├── scoreboard/           (8 files)  — court-only spectator/scoreboard bits
│   │                                       (BasketballSpectatorView, NetballSpectatorView,
│   │                                        CentrePassIndicator, TimeoutsPanel,
│   │                                        FoulFatigueWatchlist, QuarterAutoSubControlPanel,
│   │                                        CuesToggle, SoccerSpectatorView, spectatorTypes)
│   └── home/
│       └── CourtBoardResumeCard.tsx
├── hooks/
│   ├── useBasketballGameSync.ts
│   ├── useBasketballBoardState.ts
│   ├── useBasketballCoachAssistant.ts
│   ├── useNetballGameSync.ts
│   ├── useCourtSpectator.ts (+ 2 concurrency/sessionLock tests)
│   ├── useCourtBoardDefaults.ts
│   └── useSubConfirm.ts
└── pages/
    └── WatchLiveTeamPage.tsx
```

## Sites that were edited (not moved)

Grep for `archived` in these files to find the exact call sites that were
gutted or stubbed:

- `src/App.tsx` — removed `WatchLiveTeamPage` lazy import + `/watch/team/:teamId` route
- `src/pages/HomePage.tsx` — removed `<CourtBoardResumeCard />`
- `src/pages/TeamDetailPage.tsx` — removed Netball/Basketball board modal portals
- `src/pages/EventDetailPage.tsx` — removed Netball/Basketball board modal portals; forced `canAccessNetballBoard = canAccessBasketballBoard = false`
- `src/components/chat/BoardViewerDialog.tsx` — always renders `PitchBoard` (soccer) regardless of stored sport

## DB values NOT touched

- `clubs.sport` still tolerates any value (basketball, netball, cricket, etc.) — used only for branding
- `game_results.sport` unchanged (0 non-soccer rows in prod)
- `competitions.sport` unchanged
- `active_games` rows written by archived boards will remain but be inert

## Restore procedure

If you ever need court sports back:

1. `git mv archive/sports/components/basketball src/components/basketball`
2. `git mv archive/sports/components/netball src/components/netball`
3. `git mv archive/sports/components/scoreboard/* src/components/scoreboard/`
4. `git mv archive/sports/components/home/CourtBoardResumeCard.tsx src/components/home/`
5. `git mv archive/sports/hooks/* src/hooks/`
6. `git mv archive/sports/pages/WatchLiveTeamPage.tsx src/pages/`
7. In the 5 edited files above, restore the deleted imports and JSX (git blame will show them under the "archived" marker commit).

Or simpler: `git revert <archive-commit-sha>`.
