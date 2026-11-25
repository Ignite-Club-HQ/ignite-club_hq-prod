# New-game auto-sub progress

## Reproduced

A plan with seven completed substitutions out of fifteen retained 7/15 when
started from kickoff. Cancelling it also failed to empty the plan: both paths
used the ordinary plan-edit event, whose execution-history validator correctly
refuses removing or rewriting completed substitutions within a match.

The finished-clock setup reset explicitly preserved that old plan. The setup
planner could also reuse it, and an authorized shared-board reset could be
rejected by the same local edit validator.

## Changes

- New kickoff uses the existing START lifecycle event and clears executed and
  skipped markers; normal midgame starts preserve completed substitutions.
- Cancellation and new-game reset use CANCEL, clearing pending prompts,
  pause state, cooldown and activation state as well as the plan.
- A finished-game setup preserves lineup/settings, not substitution history.
- Portrait and landscape setup planners generate a fresh full-match plan;
  midgame editing can still reuse the current plan.
- Authorized shared-board snapshots use RESTORE with structural validation,
  rather than being mistaken for edits to the previous game's history.
- Ordinary SET_PLAN edits still cannot delete completed substitutions.

No saved match-stat records, clock contracts, canisters, subscription settings,
permissions or production data were changed.

## Verification boundary

Before the fix, the concrete kickoff 7/15→0/15 and cancellation regressions
failed; the same-game retention case passed. Focused hook, reset, reducer,
persistence, shared-board, event-group and timer suites pass after the fix.
Preview compilation reports build OK.

Signed-in TEST kickoff/reopen and physical-phone shared-state readback remain
unverified: the sandbox cannot mint a session for this user-managed backend,
and no Internet Identity/device session is available. No live release or
deployment was performed.