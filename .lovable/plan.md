## Confirmed root cause

`supabase/functions/process-event-notifications/index.ts` inserts all notification rows correctly (200 rows for the Strathalbyn Carnival), then tries to deliver every push inside the same request:

```text
dispatchPushBatch(...)  // for (i += 20) { await Promise.allSettled(20 fetches) }
```

Each chunk of 20 is awaited sequentially, and every fetch calls `send-push-notification` (which itself queries subscriptions, preferences and hits FCM/web-push). For 200 recipients that is 10 sequential rounds; the edge function hits its wall-clock/CPU limit and is killed after roughly the first chunk. That is exactly the observed 200 notifications / 20 `push_notification_logs`. No retry, no record of the un-attempted 180 — delivery work is not durable.

Team events (< 20 recipients) finish inside the first chunk, which is why they work today and must not change.

No stop condition from your list is triggered: the fix only changes *how already-created notification rows are scheduled and delivered*.

## Step 1 — Characterization tests before any production change

Extract, without editing logic, the pure parts of `process-event-notifications`:

- `recipients.ts` — `resolveRecipients()` moved verbatim (same queries, same pagination, same order, same dedupe/exclusion).
- `messages.ts` — `buildUpdateMessage()` moved verbatim.

New `supabase/functions/process-event-notifications/event_notify_characterization_test.ts` (Deno test, fake in-memory Supabase client that records queries):

- Team event: exact same member set; creator excluded; multi-role dedupe; other team's members absent; unrelated club members absent.
- One `event_invite` row per recipient, exact message string, `related_id = eventId`, `skip_push = true`.
- URL `/events/{id}`, tag `event_invite-{notificationId}`, title `Ignite`, type `event_invite`.
- Recipient counts 19 / 20 / 21 / 30 / 31 / 200 / 501 — first-20 behaviour unchanged.
- Mini-league, restricted-role, targeted-team and club-wide branches snapshot-tested so their audiences are provably untouched.
- Cancelled/updated actions: RSVP-only audience, `changedFields` empty → skip, creator excluded on update.
- No RSVP rows created anywhere.

These run against the current implementation first (proof they characterize existing behaviour), then again unchanged after the delivery change.

## Step 2 — Forward-only migration (durable outbox)

`public.push_delivery_queue`:

| column | notes |
|---|---|
| `id` | uuid pk |
| `notification_id` | uuid, **unique**, FK → notifications on delete cascade |
| `user_id` | uuid |
| `payload` | jsonb (body, url, tag, type, title) |
| `status` | `pending` / `processing` / `delivered` / `skipped` / `failed` |
| `attempt_count`, `next_attempt_at`, `claimed_at`, `completed_at`, `last_error`, `created_at` |

- Indexes on `(status, next_attempt_at)` and `(notification_id)`.
- RLS enabled, no client policies; `GRANT ALL ... TO service_role` only.
- `enqueue_event_push(rows jsonb)` — SECURITY DEFINER, restricted `search_path`: inserts notification rows **and** queue rows in one statement/transaction so a queue failure rolls back its notification (no orphans, both-or-neither), `ON CONFLICT (notification_id) DO NOTHING` for idempotency.
- `claim_push_delivery_jobs(limit int)` — SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`, also reclaims `processing` rows stale > 2 min; sets `processing`/`claimed_at`; returns claimed rows. `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`; grant `service_role`.
- `pg_cron` job every 30 s calling the new worker (safety net so a killed worker always resumes).

No historical migration touched; no RLS weakened.

## Step 3 — New worker `process-push-delivery-queue`

- Internal-only: requires service-role/`INTERNAL_NOTIFY_SECRET` bearer via `_shared/internal-auth.ts`; respects `outboundGuard`.
- Claims 20–50 jobs per invocation, calls the existing `send-push-notification` unchanged, records `delivered` / `skipped` (preference off, no subscription) / `failed`.
- Retries timeout/network/429/5xx with capped exponential backoff (max 5 attempts); permanent invalid-subscription → terminal `failed` immediately.
- Self-chains (fire-and-forget re-invoke) while pending work remains, so 200 recipients drain across several short invocations; concurrent workers are safe via `SKIP LOCKED`.

`process-event-notifications` keeps loading the event, resolving the audience and inserting notifications, then only enqueues and kicks the worker — it no longer awaits deliveries, so event creation is never delayed or blocked.

## Step 4 — Security hardening

- Keep `verify_jwt = false` (the DB trigger cannot mint a user JWT) but require an internal secret header; requests without it are rejected 401/403.
- Reload the event by `eventId` from the database and derive `clubId`, `teamId`, `miniLeagueId`, `createdBy`, `title`, `target_team_ids`, `restricted_to_roles` from the stored row — caller-supplied scope/audience is ignored (only `action` and `changedFields` are still read from the body).
- Migration updates `on_event_created` / `on_event_cancelled` / `on_event_updated` to send the secret header; bodies stay backward compatible.

Note: in this dev database those three triggers still `net.http_post` to the **prod** project URL/anon key (`yabcfiuntwqjwvschnji`). I'll repoint them to the current project in the same migration so dev testing exercises dev functions.

## Step 5 — Large-event & failure tests

`push_delivery_queue_test.ts` proving, with a fake claim/queue harness: exactly 200 notifications → 200 unique jobs; multiple invocations drain the queue; nothing dropped between chunks; no duplicate push per notification; worker dying after 20 leaves 180 recoverable pending jobs that a later worker completes; reprocessing the same event creates no duplicate notifications or jobs; one failing recipient doesn't stop the rest; transient → retry, permanent → terminal, disabled preference → `skipped`; stale `processing` reclaimed; concurrent workers can't claim the same notification.

## RSVP safety

Unchanged — no RSVP placeholder rows anywhere; "No Response" stays derived from the authorized roster; training defaults and all attendance displays untouched.

## Deliverables before I finish

Characterization run against old code → implement → same tests re-run unchanged → large-event/failure suites → full frontend baseline (`npx vitest run`) → byte-for-byte comparison of team-event push payloads → migration/deploy order → rollback instructions → a **manual, not-executed** repair SQL/one-shot enqueue for the existing Strathalbyn Carnival notifications that never got a push attempt (skips the 20 already in `push_notification_logs`, so no duplicate pushes).
