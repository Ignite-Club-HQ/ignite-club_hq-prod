---
name: Notification club switch must be pinned and union-verified
description: Cold-start push taps must stash the club switch directly (no CustomEvent reliance); useClubTheme bootstrap must not clobber a pinned switch; membership must union user_roles.club_id with user_roles.team_id -> teams.club_id.
type: feature
---
Symptom: app filtered to Club A, tap a push for a Club B group chat → the Club B thread opens but every other surface stays on Club A.

Three independent causes, all fixed — keep all three invariants:

1. **Cold start loses the broadcast.** `handleNotificationTap` (`src/lib/notificationLaunchHandler.ts`) dispatches `ignite:notification-tapped`, but on a true cold start `PushNotificationManager`'s listener isn't mounted yet and the event is lost (unlike `pendingNavigationUrl`, which is sessionStorage-backed). It MUST call `requestClubSwitchForNotification(data, path)` directly. The duplicate call from `PushNotificationManager.tsx` on a warm tap is harmless (idempotent sessionStorage stash).

2. **Provider bootstrap clobbers the switch.** `useClubTheme` re-asserts `activeClubTheme` from localStorage / `profiles.active_club_theme_id` in four async paths (fresh-login restore, layout-effect sync, DB load, CSS-effect fallback). Any of them can land after the switch. Fix: `markNotificationClubSwitchApplied()` pins the club in sessionStorage (`ignite_notification_club_switch_applied`, 120s TTL) and the guarded `setActiveClubThemeState` refuses any write that disagrees with the pin. `setActiveClubTheme` (club picker / applied switch) clears a disagreeing pin and writes via `setActiveClubThemeStateRaw` — explicit user selection is always authoritative.

3. **`user_roles.club_id` alone is not membership.** `useClubTheme` builds `availableClubThemes` / `userClubs` from a UNION of `user_roles.club_id` AND `user_roles.team_id -> teams.club_id`. Team-scoped role rows have `club_id = NULL`, so a direct equality check rejects legitimate members and silently drops the switch. `verifyClubMembership` in `src/hooks/useNotificationClubSwitch.ts` must union both plus `team_memberships` / `club_players`, and must return "error" (retry) rather than "no" when lookups fail.

Ruled out: `chat_groups` RLS is membership-based, not affected by the client-side active-club filter. `PushNotificationManager` is mounted unconditionally in `App.tsx`.

Guard: `src/test/notificationClubSwitchPin.guard.test.ts`.
