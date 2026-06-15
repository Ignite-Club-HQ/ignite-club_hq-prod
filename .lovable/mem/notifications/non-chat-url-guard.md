---
name: Non-chat notification URL guard
description: normalizeNotificationChatUrl / captureJumpFromNotification must early-return for non-chat URLs (/media, /schedule, /profile). Otherwise team_id/club_id in push payload rewrites them into bogus chat jumps with the related_id (e.g. photo id) used as messageId.
type: constraint
---
`getJumpTarget` falls back to payload `team_id`/`club_id`/`group_id` when the URL path doesn't match a chat regex. For `/media?photo=<id>&team=<team_id>` pushes this turned the URL into `/messages/<team_id>?message=<photo_id>` — landing user in the wrong team chat with the photo id treated as a message id (and lightbox showing wrong photo when bell tap worked fine).

Fix: both `normalizeNotificationChatUrl` and `captureJumpFromNotification` early-return when `url.pathname` doesn't start with `/messages` or `/groups/`. **Why:** push handler is the only path that runs these; the in-app bell uses `notifications.url` verbatim, which is why the bell worked and push didn't.
