# Gap-Data Recovery: Write Audit Log

Goal: after restoring the DB from a backup (daily or artifact), be able to replay every write that happened between the backup timestamp and the restore, so no user data is lost.

## How it works

```text
user write ──> table (INSERT/UPDATE/DELETE)
                │
                └─> trigger ──> public.write_audit_log (row JSON + metadata)
                                        │
                                        └─> hourly edge function
                                                    │
                                                    └─> Supabase Storage
                                                        (audit-log bucket, JSONL files)

restore day:
  1. restore prod from backup (loses gap writes AND audit table)
  2. download audit JSONL files from Storage covering [backup_ts, incident_ts]
  3. run replay script → re-applies INSERTs/UPDATEs/DELETEs in order
```

The audit table lives in the DB (fast writes, no network in the hot path), but is **continuously exported to Storage** so it survives a full restore.

## Critical tables to audit

User-generated writes only — skip logs, presence, analytics, caches.

- events, rsvps, event_payments, event_guests, event_groups, event_group_players, event_group_duties
- teams, clubs, team_memberships, club_players, children, child_guardians
- messages: club_messages, team_messages, group_messages, direct_messages, chat_groups
- photos, photo_albums, photo_comments, photo_reactions
- competitions, competition_matches, competition_entries, game_results, game_player_stats
- mini_leagues, mini_league_sessions, mini_league_players, mini_league_session_availability
- class_enrolments, class_attendance
- profiles, user_roles, notification_preferences
- vault_folders, vault_files, vault_drive_links
- polls, poll_options, poll_votes
- eoi_submissions, member_referrals, member_subscription_payments, iap_transactions
- drills, training_session_drills, event_session_drills

~40 tables. Skip: *_log, *_perf, presence, unread caches, reminder_log, views, cron_locks.

## Build steps

### 1. Audit table + generic trigger

```sql
CREATE TABLE public.write_audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,      -- INSERT | UPDATE | DELETE
  row_id TEXT,                  -- primary key as text
  row_data JSONB NOT NULL,      -- NEW for INSERT/UPDATE, OLD for DELETE
  old_data JSONB,               -- OLD for UPDATE (for reconstructing state)
  actor_id UUID,                -- auth.uid() if available
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.write_audit_log (occurred_at);
CREATE INDEX ON public.write_audit_log (table_name, occurred_at);
```

Generic trigger function that captures NEW/OLD as JSONB, attaches actor, table name, operation.

Attached to all critical tables via a helper: `SELECT attach_write_audit('events'); ...`

### 2. Retention

Nightly cron prunes rows older than 30 days from `write_audit_log` (after they've been exported). Keeps table small — writes stay fast.

### 3. Hourly export to Storage

New private bucket: `audit-log-exports`.

Edge function `export-write-audit` (scheduled hourly via pg_cron):
- Queries rows since last export cursor
- Writes JSONL file: `audit-log-exports/YYYY/MM/DD/HH.jsonl`
- Advances cursor stored in `app_settings`

This is the critical piece — Storage survives DB restore.

### 4. Replay script (documented, not automated)

`scripts/replay-audit-log.ts` — takes a start and end timestamp, downloads the matching JSONL files from Storage, replays them via service-role client:
- INSERT: upsert with original id + row_data
- UPDATE: update by id with row_data
- DELETE: delete by id

Manual, run-once-during-incident tool. Documented in `PROMOTION.md`.

### 5. Write-overhead check

After deploying triggers, spot-check `chat_open_perf` and event RSVP timings. Expect ~5-10% overhead on writes; if worse, drop audit on the highest-volume tables (messages) and rely on chat's own retention for those.

## What this does NOT cover

- Storage file uploads (photos, vault files) — files themselves are already durable in Storage buckets and unaffected by DB restore. Only DB rows referencing them are audited.
- Schema changes — reverse migrations still handle these.
- Auth.users writes — Supabase-managed, out of scope.

## Trade-offs vs PITR

| | Audit Log | PITR |
|---|---|---|
| Cost | ~$0 | $100/mo |
| Coverage | Only listed tables | Entire DB |
| Restore granularity | Per-write | Per-second |
| Replay effort | Manual script run | Automatic |
| Build effort | 1–2 days | 0 |
| Ongoing maintenance | Prune + monitor exports | None |

Good enough for current scale. Revisit PITR when revenue justifies it or the audit list becomes unwieldy.

## Deliverables

1. Migration: `write_audit_log` table, `attach_write_audit` helper, triggers on ~40 tables, retention function
2. Storage bucket `audit-log-exports` (private)
3. Edge function `export-write-audit` + pg_cron hourly schedule
4. Replay script + `PROMOTION.md` runbook section
