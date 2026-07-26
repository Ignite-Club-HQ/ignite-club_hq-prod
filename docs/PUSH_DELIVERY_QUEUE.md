# Event push delivery queue — operations & test guide

The event push fan-out is a **durable outbox**. `process-event-notifications`
resolves the audience and atomically creates notification rows + queue jobs;
`process-push-delivery-queue` drains the queue in bounded batches. A `pg_cron`
job is the authoritative recovery mechanism, so a killed worker always resumes.

```text
event trigger ──► process-event-notifications
                    └─ enqueue_event_push_v2()  (atomic: notification + job)
                          │
pg_cron (every minute) ──► process-push-delivery-queue
                            └─ claim_push_delivery_jobs(30)  FOR UPDATE SKIP LOCKED
                                  └─ send-push-notification (per job, 20s AbortController)
```

## Prerequisites (verify before promoting to prod)

```sql
select * from public.push_delivery_preflight();
```

All rows must be `ok = true`. It checks `pg_cron`, `pg_net`, `supabase_vault`,
the `functions_base_url` / `service_role_key` Vault secrets (present, valid
shape, not a placeholder) and that the `ignite-push-delivery-queue-worker`
cron job is installed and active. It never returns secret values.

## Monitoring

```sql
select * from public.push_delivery_queue_stats();      -- jobs by status + oldest
select * from public.push_delivery_cron_failures(20);  -- failed cron runs
```

Healthy: `pending` drains to 0 within a few minutes; `processing` never has an
`oldest_created_at` older than ~2 minutes (stale rows are auto-reclaimed).

## Recovery for one event

```sql
select * from public.repair_event_push_queue('<event-uuid>', true);   -- dry run
select * from public.repair_event_push_queue('<event-uuid>', false);  -- queue them
```

Only queues notifications that have **no** queue job and **no** push log in the
surrounding window, so it cannot double-push. It is idempotent.

## Running the baseline

```bash
./scripts/run-baseline.sh      # or: npm run baseline
```

1. **Frontend** — `vitest run`.
2. **Edge functions** — `deno test`:
   - `process-event-notifications/event_notify_characterization_test.ts` —
     12 tests pinning the audience (team / mini-league / club-wide /
     restricted-role / targeted-team), the exact message strings, payload shape
     and "no RSVP rows ever" invariant. These predate the queue work and are
     **unchanged**, which is the proof team-event behaviour did not move.
   - `process-event-notifications/push_delivery_queue_test.ts` — 20 tests
     driving the real worker code: draining 200 jobs across invocations with
     nothing dropped or duplicated, mid-run termination leaving the remainder
     recoverable, retry vs terminal classification, capped backoff,
     `skipped` ≠ `delivered`, status-update failure staying recoverable,
     no-downgrade guard, concurrent claim safety, stale reclaim, and dedupe-key
     idempotency.
   - `process-push-delivery-queue/internal_auth_test.ts` — 12 tests pinning the
     auth boundary (anon key, user JWT, near-miss token and missing header are
     all rejected; failures never echo the key).
3. **Database** — `supabase/tests/push_delivery_queue_test.sql` against a
   **fresh local stack** (`supabase start`; defaults to
   `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, override with
   `BASELINE_DB_URL`). It asserts the SQL contract itself: exact fan-out counts
   at 19/20/21/30/31/200/501 recipients, repeat fan-out creating zero
   duplicates, atomicity (no notification without a job), versioned updates vs
   deduped retries, no RSVP rows, claim bounds / skip-locked / stale reclaim /
   terminal-never-reclaimed, scoped repair, the cron job's identity and that it
   embeds no URL or secret, and that `anon` / `authenticated` can reach neither
   the queue table nor any of its functions.

   The runner refuses non-localhost targets. The suite is wrapped in
   `BEGIN … ROLLBACK` and uses only synthetic UUIDs — no real club, event or
   user data, and no external push is ever sent.

If no local stack is running, step 3 reports `SKIP` (not a pass) and steps 1–2
still gate the baseline.

## Deployment order

1. Apply the migrations (preflight + queue + cron).
2. Confirm `push_delivery_preflight()` is all-green in the target environment.
3. Deploy `process-push-delivery-queue`, then `process-event-notifications`.
4. Create a low-stakes event and watch `push_delivery_queue_stats()` drain.

## Rollback

The cron job is the only always-on component:

```sql
select cron.unschedule('ignite-push-delivery-queue-worker');
```

Queue rows stay untouched; re-scheduling resumes delivery. Notification rows
are unaffected either way, so the in-app bell keeps working even with delivery
paused.

## Known limitations

- Delivery is **at-least-once**. If a worker dies after the push but before its
  status write, the stale-reclaim path retries that job. The per-notification
  `tag` collapses the duplicate on-device.
- `dedupe_key` makes *fan-out* exactly-once per event/user/action-version, so
  retrying a trigger or double-invoking the function cannot create a second
  push.
- The queue-simulation tests mirror `claim_push_delivery_jobs()` semantics;
  the authoritative assertion of those semantics is the SQL suite, which needs
  a local Postgres.
