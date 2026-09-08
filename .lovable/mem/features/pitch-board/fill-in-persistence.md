---
name: Fill-in player persistence
description: Fill-ins persist with the planned lineup across days/devices; only purged on game finish or when opening a different fixture
type: feature
---

Fill-in (guest) players added on the pitch board belong to the fixture and MUST persist until that game is played:

- `loadPitchState` stale reset (>12h, no live timer) in `pitchStateUtils.ts` keeps fill-ins — only resets minutes/injuries/goals/auto-sub/linkedEventId.
- `buildEventLineupSnapshot` in `eventLineupRepository.ts` includes fill-ins in the `event_lineups` DB snapshot (keyed by event_id), so they sync cross-device.
- Fill-ins are purged ONLY by: (1) `GameFinishedDialog` on game finish, (2) PitchBoard's `savedStateIsForDifferentEvent` gate when opening a DIFFERENT event than the saved state.

**Why:** Coach added fill-ins for a game, checked the board the next day and they were gone — the stale reset and DB snapshot were stripping them (reported 2026-08-21).
