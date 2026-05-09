## RSVP Quick-Wins Sprint

Three improvements to lift RSVP response rates from ~58% toward 70%+, built in dependency order. All three reuse existing infrastructure (push pipeline, RSVP table, event detail page).

---

### 1. Nudge Non-Responders (Coach action)

A one-tap button on the event detail page (visible only to coaches/team admins/club admins) that sends a push notification + in-app notification to every rostered child's parent and every staff member who has not yet RSVP'd.

**UX**
- Button appears in the event admin actions area: "Nudge non-responders (N)" where N = count of unresponded.
- Disabled when N = 0.
- Confirmation sheet: "Send a reminder to N people?" → Send.
- 24-hour cooldown per event (prevents spam). Button shows "Nudged 2h ago" when on cooldown.
- Toast on success: "Nudged 12 people".

**Backend**
- New edge function `send-rsvp-nudge` (mirrors structure of existing `send-event-view-reminder`).
- Computes unresponded set server-side: roster (children) + staff (coaches/team_admins) minus rsvps where `child_id` or staff `user_id` already responded.
- Sends through existing `send-push-notification` with deep link `/events/:id`.
- Writes a row to a new `rsvp_nudge_log` table for cooldown enforcement and analytics.

---

### 2. Parent Red-Dots on Unresponded Kids

Visual accountability indicator on the event detail page: each of the parent's own children that hasn't been RSVP'd shows a red dot + "Awaiting your response" label next to the child's name in the RSVP section.

**UX**
- Red 8px dot beside child name, with subtle pulse animation.
- Tapping the dot scrolls to / opens the RSVP control for that child.
- Disappears the instant the parent submits a status.
- Also surfaces a single summary chip at the top of the event page: "2 of your kids haven't RSVP'd".

**Frontend only** — uses data already loaded by `useEventGoingAttendees` plus the user's children list.

---

### 3. One-Tap RSVP from Push

Action buttons on push notifications so a parent can answer Going / Maybe / Out without opening the app.

**Backend**
- Push payload (FCM + APNs + Web Push) gains `actions: [Going, Maybe, Out]` and `data: { eventId, childId, action: "rsvp_quick" }`.
- New edge function `quick-rsvp` accepts `{ eventId, childId|null, status }` with auth, validates the user has rights to RSVP for that child, and upserts the row.
- iOS APNs requires a custom notification category (`RSVP_QUICK`) registered at app launch — handled in `AppDelegate.swift` + Capacitor push registration.
- Android FCM uses notification action buttons via the existing FCM service worker (`public/sw.js`) and the native push plugin.

**Frontend**
- `sw.js` notification click handler routes the action ID → `quick-rsvp` edge function call → silent toast on next app open.
- Native: `PushNotifications.addListener('pushNotificationActionPerformed')` handles the same.
- Where the push targets multiple kids of one parent, only the "Going for all" / "Open app to choose" actions are shown (avoids overflowing the 3-action limit).

---

### Database Changes

- **`rsvp_nudge_log`** — records every nudge: event_id, sent_by, sent_at, recipients_count. Enforces 24h-per-event cooldown and powers a future "nudge effectiveness" metric.
- No changes to `rsvps`, `events`, or push tables.

### Security

- `send-rsvp-nudge` validates JWT, confirms requester has coach/team_admin/club_admin role for the event's team or club (mirrors `send-event-view-reminder`'s authorization block).
- `quick-rsvp` validates JWT and confirms the requester is the parent of `childId` (or the staff user themselves).
- `rsvp_nudge_log` RLS: insert via edge function only (service role), select limited to admins of the same team/club.

### Build Order

1. **Migration** — create `rsvp_nudge_log` table + RLS.
2. **Backend** — `send-rsvp-nudge` edge function + `quick-rsvp` edge function.
3. **Frontend** — Nudge button on event page, red-dots UI, summary chip.
4. **Push payload** — extend `send-push-notification` to attach RSVP action buttons when `data.kind === "rsvp_reminder"`; update `sw.js` and native push listeners to handle action clicks.
5. **iOS only** — register `RSVP_QUICK` category in `AppDelegate.swift`.

### Out of Scope (deferred from the 12-lever list)

- Auto-reminder cadence cron (T-72h/T-24h/T-3h)
- Default-to-Going for regulars
- SMS fallback
- Squad availability live view
- Streaks/badges, smart silence detection

These can come in the next sprint once we have nudge + quick-RSVP telemetry to measure lift.
