---
name: Home resume empty-membership guard
description: Why Home must never trust a zero-row user_roles read on app resume (Next Up vanishing / "set up your club" card flash)
type: feature
---
On phone unlock / app resume the Supabase access token can be expired-but-not-yet-rotated. RLS then returns ZERO rows with NO error, so `user_roles` reads look "successfully empty". In `src/pages/HomePage.tsx` that used to flip Home into the new-user empty state (`HomeWelcomeGetStarted`, "set up your club") and blank the Next Up carousel; a full app kill fixed it because auth restored before the first fetch.

Invariants:
1. An empty `user_roles` result is only trusted when *verified*: an active session exists AND (if the cached snapshot had memberships) `refreshSessionOnce()` succeeded and a re-read is still empty. Otherwise throw so React Query retries and keeps last good data.
2. `setCachedNextUp` must never overwrite a non-empty snapshot with an empty one. Verified-empty clears the snapshot explicitly via `clearCachedNextUp`.
3. `isNewUserEmptyState` requires `!isFetching` — never claim "new user" while a focus/resume refetch is in flight.
