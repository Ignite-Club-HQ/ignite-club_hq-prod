

## Safe Scalability Improvements Plan

Two low-risk changes to prepare the app for growth, based on actual data: 5,056 notifications (2,859 older than 30 days, only 9 marked read) and unbounded prefetch queries on every login.

---

### 1. Notifications Cleanup (Scheduled Edge Function)

**What**: A new Edge Function + cron job that runs daily and deletes old, read notifications to prevent unbounded table growth.

**Rules**:
- Delete read notifications older than 30 days
- Delete unread notifications older than 90 days (users aren't coming back for these)
- Log how many were cleaned up

**Implementation**:
- Create `supabase/functions/cleanup-old-notifications/index.ts` — simple service-role function that runs two DELETE queries
- Add config entry to `supabase/config.toml` with `verify_jwt = false`
- Schedule via `pg_cron` (daily at 3am UTC) using the same pattern as existing cron jobs

**Risk**: None to current app. It only deletes rows that are already invisible to users (old + read). The 90-day unread cutoff is generous.

---

### 2. Prefetch Optimization (Cap Login Queries)

**What**: Limit `prefetchUserData` so it doesn't fire unbounded parallel queries for every team/club/group a user belongs to.

**Current problem**: A user in 8 teams, 3 clubs, and 5 groups fires 16+ parallel Supabase queries on every login. A power user in 15+ entities would spike to 30+ queries.

**Changes to `src/lib/prefetchData.ts`**:
- Cap team message prefetch to the 5 most recent teams (by role creation or last message activity)
- Cap club message prefetch to 3 clubs
- Cap group message prefetch to 5 groups
- Cap DM conversation prefetch to 5 conversations (currently 10)
- Remaining chats load on-demand when the user navigates to them (existing React Query fetch handles this seamlessly)

**Risk**: Minimal. Users will see a brief loading state when opening an older/less-used chat for the first time after login. Messages are already fetched on-demand in each chat page component, so this just removes the speculative pre-warm for less active chats.

---

### Technical Details

**Cleanup function** follows the exact same pattern as the existing `cleanup-push-subscriptions` function — CORS headers, service role client, batch deletes, JSON summary response.

**Prefetch caps** are applied by slicing the `teamIds`, `clubIds`, and `accessibleGroups` arrays before the message fetch loop. No changes to cache structure, query keys, or chat page components.

