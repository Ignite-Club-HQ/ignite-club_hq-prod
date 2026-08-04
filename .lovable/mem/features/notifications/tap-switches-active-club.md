---
name: Notification tap switches active club
description: Push/notification taps for a thread in another club MUST move the global active-club filter to that club (membership-verified). Chat page renders still must never mutate it.
type: feature
---
Tapping a notification for a message in Club B while the app is filtered to Club A previously opened the Club B thread but left every other surface (header, home, inbox, media, schedule) on Club A.

Rule: a notification tap is a USER-DRIVEN action, so it MAY move the club filter — same rationale as `seedClubFilterFromInvite`. Rendering a chat page still must NOT (see `useSyncActiveClubToChat`, which stays a no-op).

Implementation:
- `src/lib/notificationClubSwitch.ts` — `requestClubSwitchForNotification(data, url)` resolves the owning club (explicit `club_id` → team→club → chat_group→club → club_admin_conversation→club; DM/broadcast resolve to null) and stashes it in sessionStorage under `ignite_pending_notification_club_switch` (2 min TTL, swept by `clearUserScopedCaches`).
- Called from the native tap broadcast handler and the web push handlers (`PushNotificationManager`, `webNotificationLaunchHandler` for cold start).
- `src/hooks/useNotificationClubSwitch.ts` (mounted in `PushNotificationManager`, inside `ClubThemeProvider`) verifies membership via `user_roles` before calling `setActiveClubTheme`. Unverified/unresolved → filter untouched; failed lookup keeps the request pending for retry.
