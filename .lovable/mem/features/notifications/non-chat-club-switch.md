---
name: Non-chat notification taps must resolve the owning club from the URL
description: Push/bell taps for events, media, teams, clubs, rewards carry no club_id, so club resolution must fall back to resolveRouteClubScope + photo lookup; an in-flight pin keeps useClubScopeGuard from bouncing home mid-switch.
type: feature
---
Only `club_message` and `club_admin_message` pushes actually carry `club_id` in the delivered `data` payload; every other type (events, media/photos, membership, rewards, invites, pitch board) omits it, and `getJumpTarget` only understands chat URLs. Result before the fix: tapping such a push while filtered to another club left the filter on the old club and `useClubScopeGuard` bounced the user straight home.

Invariants:
1. `resolveNotificationClubId` (src/lib/notificationClubSwitch.ts) resolves, in order: explicit payload `club_id` → chat jump target → **URL via `resolveRouteClubScope`** (plus a `photos` lookup for `/media?photo=`) → payload `team_id` → teams.club_id. DM/broadcast still resolve to null.
2. `stash()` writes a short-TTL (30s) in-flight marker `ignite_notification_club_switch_inflight`. `useClubScopeGuard` honours BOTH the applied pin and the in-flight marker, and re-checks after 1s so a rejected membership check still scopes the route out. `useNotificationClubSwitch` clears the marker on every terminal outcome (applied / not a member / no club).
3. In `NotificationsPage.handleNotificationClick`, non-chat branches navigate through a local `navigate` wrapper that calls `requestClubSwitchForNotificationUrl` first (bounded 600ms) — bell taps are user-driven and MAY move the club filter, same as push taps.

Tests: `src/test/notificationClubSwitch.test.ts`.
