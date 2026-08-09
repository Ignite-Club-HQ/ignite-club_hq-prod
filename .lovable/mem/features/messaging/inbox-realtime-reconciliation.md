---
name: Inbox realtime reconciliation
description: Messages inbox must route Realtime events through the buffering coordinator and merge query responses against preview watermarks
type: feature
---

All inbox Realtime handling in `MessagesPage` goes through
`src/features/messaging/inbox/inboxRealtimeReconciliation.ts`:

1. **Buffering coordinator** (`createInboxRealtimeCoordinator`) — events arriving
   before authorized scopes are `ready` are buffered (bounded, oldest dropped)
   and replayed exactly once. `attemptFlush()` is idempotent and must be called
   from BOTH sides of the race: when auth becomes ready, and when the applier is
   installed in the channel effect. Never clear the buffer on ordinary
   re-renders — only on sign-out, user change, `status === 'failed'`, or channel
   teardown. Authorization stays fail-closed because replay re-runs the same
   `isAuthorized` check inside the handlers.

2. **Preview watermarks** (`createInboxPreviewWatermarks`) — every Realtime
   preview patch (and edit patch) must `note()` the preview under
   `team:<id>` / `club:<id>` / `group:<id>`, and every derived
   `latestTeamMessages` / `latestClubMessages` / `latestGroupMessages` must be
   `previewWatermarks.reconcile(scope, ...)` of the query data. This makes
   preview freshness monotonic: an authoritative response that started before a
   Realtime event can never regress to older/empty preview text, while a
   genuinely newer response still wins.

Do not reintroduce ad-hoc `pending*RealtimeRef` buffers or read
`latestMessages` straight off the query result.
