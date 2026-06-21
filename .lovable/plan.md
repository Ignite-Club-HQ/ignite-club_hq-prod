# Match Result Entry Redesign

A complete rework of `MatchScoreCard` into a fast, sport-aware, mobile-first result entry flow. Score-only saves stay one tap; rich stats are progressively disclosed.

## Architecture

Split the single 600-line `MatchScoreCard.tsx` into a small system:

```text
src/components/event/result/
  MatchResultCard.tsx          // summary card + entry trigger
  MatchResultSheet.tsx         // bottom sheet shell, drives flow
  ScoreInputs.tsx              // large 2-up numeric inputs (universal)
  StatsAccordion.tsx           // "Add match statistics" disclosure
  sections/
    GoalScorersSection.tsx     // soccer / futsal / hockey / handball
    CardsSection.tsx           // soccer / futsal
    AflScoreSection.tsx        // goals + behinds, auto "8.10 (58)"
    CricketSection.tsx         // wickets, overs, batting/bowling
    VolleyballSection.tsx      // set-by-set scores
    AwardsSection.tsx          // best on court / MVP / best players
    NotesSection.tsx           // free-text match notes
  ResultSummaryToast.tsx       // post-save summary + quick actions
```

Sport behaviour comes from an expanded `src/lib/sportScoreConfig.ts` (existing file) — one config per sport drives:
- Title + unit vocabulary (already done)
- Required score inputs (single pair vs AFL's two pairs)
- Which optional sections to render (`sections: ['scorers','cards','notes']`)
- Auto-generated summary sentence formatter (`formatResultSentence`)

## Universal sheet layout

```text
┌──────────────────────────────┐
│ ⚽  Record Football Result  ✕│
├──────────────────────────────┤
│   Riverside        Stirling  │
│  ┌────────┐  vs  ┌────────┐  │
│  │   3    │      │   1    │  │  ← 56px tall, numeric keypad
│  └────────┘      └────────┘  │
│                              │
│  Riverside won 3–1           │  ← live preview
│                              │
│  ▾ Add match statistics      │  ← collapsed by default
├──────────────────────────────┤
│ [ Cancel ]   [ Save result ] │  ← sticky footer above keyboard
└──────────────────────────────┘
```

- Uses existing `ResponsiveDialog` (bottom drawer on mobile, dialog on desktop) — already wired in current file.
- Score inputs are 56px tall, `text-3xl font-bold`, `inputMode="numeric"`, auto-focus first input on open.
- Live result sentence updates as scores change ("Draw 2–2", "Riverside won 3–1").
- Sticky footer respects `pb-safe` and stays above the keyboard via the drawer's existing keyboard handling.

## Sport-specific score blocks

Selected via `sportConfig.scoreLayout`:

- **default** — single pair of inputs (soccer, netball, basketball, hockey, rugby, handball, baseball, generic).
- **afl** — two stacked pairs (Goals / Behinds) plus auto-rendered `G.B (Total)` line.
- **cricket** — Runs + Wickets per team in one row (`120/6`), optional Overs.
- **volleyball** — Sets won pair + collapsible per-set scores list.
- **tennis** — Sets won pair + collapsible per-set scores list (reuses volleyball component).

Each layout still writes to the same `game_results` row:
- `home_score` / `away_score` = primary number
- `period_scores` jsonb = secondary stats (`{home:{wickets,overs}, away:{...}}` or `[{home,away}, ...]` for sets/AFL behinds)
- `player_stats` jsonb = scorers / batters / awards

No DB migration needed — existing columns cover every sport.

## Optional sections

All hidden inside a single "Add match statistics" accordion so the default path is *enter two numbers → Save*. Sections shown depend on `sportConfig.optionalSections`:

- `scorers` — current goal-scorer picker (already built), relabelled per sport
- `cards` — yellow/red card counters with player picker (soccer/futsal only)
- `awards` — single-select player picker for "Best on Court / MVP / Best Players" (stored as `player_stats` entry with `award: 'mvp'`)
- `notes` — multiline textarea, stored in new `game_results` column `notes text` *(only DB change required — see below)*
- Sport-specific (cricket batting/bowling, volleyball sets, AFL goal kickers) rendered inline

## Post-save summary

After `upsert` succeeds:
- Sheet closes
- Toast renders the auto-formatted sentence + 3 quick actions:
  - **Share result** — Web Share API with the sentence
  - **Notify team** — posts the sentence to the event's team chat (reuses existing `auto-post-event-to-chat` style flow if available, otherwise direct insert into `team_messages` from a bot profile — confirm before wiring)
  - **Enter statistics** — reopens the sheet with the stats accordion pre-expanded
- Updated summary card on `EventDetailPage` shows the sentence + win/draw/loss badge (already there).

## Auto-save draft

While the sheet is open, debounce writes (1.5s) to `localStorage` under `ignite_match_draft_${eventId}` containing `{ homeScore, awayScore, period, players, notes, savedAt }`. On reopen, hydrate from draft if newer than the server row and show a small "Draft restored" chip with an "Discard draft" affordance. Draft cleared on successful save.

## Admin configuration (deferred)

Competition-level "required vs optional" stats is out of scope for this pass — we land sport-driven defaults first. Hook is a `competition_id?: string` prop on `MatchResultSheet` that can later read overrides from a new `competition_result_config` table. Noted in code with a `TODO(competition-config)` comment, no schema work now.

## Database

One migration:

```sql
ALTER TABLE public.game_results
  ADD COLUMN IF NOT EXISTS notes text;
```

No RLS or grant changes — table already has them. Migration ships with this work only because the Notes optional section needs persistence.

## Files

**New**
- `src/components/event/result/MatchResultCard.tsx`
- `src/components/event/result/MatchResultSheet.tsx`
- `src/components/event/result/ScoreInputs.tsx`
- `src/components/event/result/StatsAccordion.tsx`
- `src/components/event/result/sections/GoalScorersSection.tsx`
- `src/components/event/result/sections/CardsSection.tsx`
- `src/components/event/result/sections/AflScoreSection.tsx`
- `src/components/event/result/sections/CricketSection.tsx`
- `src/components/event/result/sections/VolleyballSection.tsx`
- `src/components/event/result/sections/AwardsSection.tsx`
- `src/components/event/result/sections/NotesSection.tsx`
- `src/components/event/result/ResultSummaryToast.tsx`
- `src/components/event/result/useMatchResultDraft.ts`
- `src/lib/matchResultFormat.ts` — `formatResultSentence(sport, home, away, labels)` covering all sports listed (soccer "won 3–1", cricket "won by 22 runs"/"won by 4 wickets", AFL "8.10 (58) d 6.8 (44)", volleyball "3–1 in sets", etc.)

**Edited**
- `src/lib/sportScoreConfig.ts` — add `scoreLayout`, `optionalSections`, `iconKey` per sport; add tennis preset; extend `getSportScoreConfig` matcher for futsal/tennis/softball.
- `src/components/event/MatchScoreCard.tsx` — becomes a thin re-export of `MatchResultCard` so existing imports keep working.
- `src/pages/EventDetailPage.tsx` — no logic changes (already routes through `MatchScoreCard`).

**Deleted**
- None (old card is kept as the public API shim).

## Out of scope

- Competition-admin stat configuration UI (stub only)
- Edit-later workflow beyond what `upsert` already supports
- Ladder integration ("View ladder" quick action will be added only if a ladder route exists for this event's competition — confirm during build)

---

# Parked: Realtime Scope Fix for message_reactions

## Problem

All `message_reactions` realtime subscriptions are currently table-wide (no filter). Every INSERT/UPDATE/DELETE on `message_reactions` broadcasts to every open chat page across the app, regardless of context. As MAU grows this wastes Supabase Realtime bandwidth and burns client CPU processing irrelevant events.

## Solution

Mirror the existing `message_reads` `scope_key` pattern that was shipped in Phase 5a.

## Database work

One migration:

1. `ALTER TABLE public.message_reactions ADD COLUMN IF NOT EXISTS scope_key text;`
2. Create `public.message_reactions_compute_scope_key(_row public.message_reactions)` — same 6-branch logic as `message_reads_compute_scope_key` (team_message_id -> team_id, club_message_id -> club_id, group_message_id -> group_id, direct_message_id -> conversation_id, club_admin_message_id -> conversation_id, broadcast_message_id -> 'broadcast').
3. Create `public.set_message_reactions_scope_key()` BEFORE INSERT trigger that populates `scope_key` via the compute function if NULL.
4. Backfill existing rows with equivalent UPDATE ... FROM joins for each message type.
5. `CREATE INDEX IF NOT EXISTS idx_message_reactions_scope_key ON public.message_reactions (scope_key);`

## Frontend work

Update all 18 `message_reactions` `postgres_changes` subscriptions across the chat pages to add `filter: \`scope_key=eq.${scopeKey}\``.

Pages affected:
- `src/pages/TeamChatPage.tsx` (INSERT / UPDATE / DELETE x 1 channel)
- `src/pages/ClubChatPage.tsx` (INSERT / UPDATE / DELETE x 1 channel)
- `src/pages/GroupChatPage.tsx` (INSERT / UPDATE / DELETE x 1 channel)
- `src/pages/DirectMessagePage.tsx` (INSERT / UPDATE / DELETE x 1 channel)
- `src/pages/BroadcastChatPage.tsx` (INSERT / UPDATE / DELETE x 1 channel)

The `scopeKey` string is already constructed on each page for the `message_reads` subscription (e.g. `teamId`, `clubId`, `groupId`, `conversationId`, or `'broadcast'`). Reuse the same variable.

Also update `src/integrations/supabase/types.ts` to include `scope_key?: string | null` on the `message_reactions` Row/Insert/Update interfaces.

## Rollout and testing notes

- Deploy the DB migration first. Verify `scope_key` populates correctly for a few reactions of each message type before touching frontend code.
- Update frontend subscriptions only after the trigger is confirmed working in production.
- If any chat type's `scope_key` derivation is wrong, live emoji reactions in that context will silently stop updating (payloads are filtered out by the mismatch). Test all 6 contexts before declaring complete.
- No backfill required for realtime correctness — Realtime only streams new changes, so existing rows do not affect live updates. Backfill is for consistency / potential future query use.
- Keep old table-wide subscriptions as a fallback behind a feature flag for 24 hours if desired, or test heavily in staging first.
