---
name: Coverage-loss club theme resilience
description: Never sign out on network-failed refreshSession; never accept empty club/theme list under a degraded session
type: constraint
---

Two invariants keep the club switcher + theme alive across coverage drops:

1. `useAuth` resume/reconnect recovery must NOT clear the query cache or `setUser(null)`
   when `refreshSession()`/`getSession()` failed for network reasons. Classify with
   `isTransientAuthFailure` (`src/lib/authRecoveryClassification.ts`) and bail out.
   Only `refresh_token_not_found`-class failures may tear down the session.
   Recovery also re-runs on `onlineManager` reconnect.

2. Club list queries (`club-themes`, `user-clubs-for-switcher`, `all-user-clubs-for-theme-v2`)
   must pass every result through `guardClubListResult` (`src/lib/clubListEmptyGuard.ts`).
   PostgREST can return 200-with-zero-rows under a degraded auth context; committing that
   empties the switcher and evicts the cached theme permanently. Empty is only truth when
   online with a valid, unexpired session, or when the key never had data.

Regression test: `src/test/clubThemeCoverageLoss.guard.test.ts`.
