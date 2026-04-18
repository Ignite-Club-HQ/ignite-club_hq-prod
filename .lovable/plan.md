
## Goal
Restore 1-tap scoring speed and tighten the live-game hierarchy without re-adding clutter. The popover scoring path already exists in `GameScoreboard.tsx` — it needs visual affordance, tighter spacing above/below, and the "Score by period" needs to drop out of the always-visible flow (it already lives in the drawer, but the standalone insights drawer triggers come too early).

## Changes

### 1. `src/components/scoreboard/GameScoreboard.tsx` — make scoring feel tappable + faster
- **Score affordance**: wrap the score number in a pill-shaped tap target with:
  - subtle `bg-muted/40` background tint
  - `rounded-lg`, slight padding (`px-3 py-1`)
  - `active:scale-95` + `active:bg-muted/60` ripple
  - `hover:bg-muted/60` on devices with hover
- **Size bump**: scores from `text-5xl` → `text-6xl` (~+15%), `landscape:text-7xl`. Team labels opacity drop (`text-muted-foreground/70`).
- **Tighter row**: reduce vertical padding `py-2.5` → `py-2`. Gap between team label and score `gap-0.5` for visual grouping.
- **Popover sizing**: keep +1/+2/+3 pills but make them `h-12 min-w-14` with stronger `text-lg font-bold` and `sideOffset={4}` so they appear directly under the score.
- **Auto-dismiss**: already handled in `handleScore`. Confirmed.

### 2. `src/components/basketball/BasketballBoard.tsx` — tighten live-mode hierarchy
- **Pull court up**: remove the unconditional bottom border on the timer row (already there) and tighten the gap between `GameScoreboard` and `BasketballCourtArea`. Replace borders between scoreboard → court with subtle spacing only (no border on scoreboard's bottom in live mode).
- **Bottom action bar slimmer**: reduce `py-1.5` → `py-1`, "Undo last sub" → ghost icon-only style with tiny label, "Game summary" stays outline but `h-7 text-[11px]`.
- **Game details trigger**: reduce padding `py-2` → `py-1.5`, lighten copy to "Game details", lower contrast.
- **Auto-sub status**: shrink to `py-1` and `text-[10px]` to claim less above-court space.

### 3. Layout diagram (live mode, after)

```text
┌──────────────────────────────────┐
│ ← TeamA vs TeamB        ✎  ◉    │  header (sticky)
├──────────────────────────────────┤
│   Q2  •   07:42   •  ▶  ⋯       │  timer
├──────────────────────────────────┤
│  TEAMA      12 — 8      OPPONENT │  scoreboard (tap score)
│  ──────────────────────────────  │     ↓ popover: [+1][+2][+3]
│                                  │
│         [ COURT — hero ]         │  ← starts ~15% higher
│                                  │
│         [ Bench (n) ]            │
├──────────────────────────────────┤
│ ▾ Game details                   │  collapsed
├──────────────────────────────────┤
│ ↶ Undo            🏆 Summary    │  slim bottom bar
└──────────────────────────────────┘
```

## What stays untouched
- All scoring/sub/timer logic in `useBasketballBoardState`
- Drawer contents (QuarterScoreStrip, TimeoutsPanel, insights) — already correctly buried
- Pre-game mode behaviour
- Per-player scoring via QuickActionSheet
