# Ignite — Scalability Plan by MAU Band

Phased engineering plan for scaling Ignite from current scale to 1M MAU. Each band lists what MUST be done before crossing that threshold. Do work in the band BEFORE the one you're approaching — not after.

---

## Now → 1,000 MAU (foundations / hygiene)

Goal: stop building scalability debt. No re-architecture needed, but lock in habits that make later bands cheap.

- **Observability baseline**
  - Keep `realtime_perf_samples` (already in place); add a daily rollup view (p50/p95 per channel) and a Supabase dashboard chart.
  - Add a `slow_queries` weekly review (use `supabase--slow_queries`); file any query >200ms p95.
  - Add Sentry (or equivalent) for frontend + edge function errors. Tag by `club_id`.
- **Index hygiene**
  - Audit every `team_messages`, `notifications`, `events`, `vault_files`, `message_reads` query for index coverage. Add composite indexes for `(team_id, created_at desc)` patterns.
  - Run `supabase--linter` monthly; fix every "unindexed FK" warning.
- **RLS cost**
  - Replace any `EXISTS (... auth.uid() ...)` policy that does a sequential scan with a `SECURITY DEFINER` function (`has_role`, `can_access_chat_group` pattern — already standard here).
- **Storage discipline**
  - Confirm `club_storage_accounting` is reconciling weekly. Add an alert if any club exceeds quota by >10%.
  - Lock chat attachments to ≤10MB, images server-resized to ≤2048px.
- **Backups & DR**
  - Verify nightly Supabase PITR is on. Test a restore once into a staging project.
  - Storage backup workflow (`.github/workflows/backup-storage.yml`) — confirm it ran in last 7 days.

Cost ceiling: should be <$200/mo Supabase + <$50/mo Netlify.

---

## 1,000 → 10,000 MAU

Goal: survive the first viral club. The risks here are realtime fanout and notification volume, not Postgres.

- **Realtime fanout audit**
  - Map every `supabase.channel(...).on('postgres_changes', ...)` subscription. For each, ask: "If this club had 500 active users in one chat, how many messages/sec does this generate?"
  - Move high-volume channels (chat typing, presence, read receipts) off `postgres_changes` and onto **Realtime Broadcast** (server-side `realtime.send()` from a trigger or edge function). `postgres_changes` does not scale past ~200 concurrent subscribers per table cheaply.
  - Cap presence channel membership per club — `useUserPresence` is global today; shard by club if any single channel exceeds 500 concurrent.
- **Notifications**
  - Move `auto-rsvp-push-cron`, `auto-rsvp-dm-cron`, `auto-post-event-to-chat` to use **batched** FCM/APNs sends (multicast), not per-user loops.
  - Add a `notifications_outbox` table + worker pattern so push generation is decoupled from the request path.
  - Dedupe table (`event_auto_push_log`, `event_auto_dm_log`) — add partial indexes and a 30-day purge cron.
- **Edge function budget**
  - Identify top-5 edge functions by invocation count. Anything >1M/mo invocations: review cold start, payload size, and whether it can be a DB trigger instead.
- **Frontend perf**
  - Lock chat virtualisation ON (already default). Verify `BasicChatMessageList` kill-switch works in load test.
  - Ship route-level code splitting if bundle >500KB gz.
- **Read-heavy caching**
  - Add HTTP-cache headers on `_headers` for public assets (logos, sponsor images) — push to CDN edge.
  - Profile `media-loading-performance` path; ensure signed URL TTL ≥1 hour to reduce churn.
- **Monitoring**
  - Add alerts: Supabase egress >50GB/day, realtime concurrent connections >2000, push success rate <95%.

Cost ceiling target: <$800/mo total.

---

## 10,000 → 100,000 MAU

Goal: stop being a single-tenant Supabase project. This is the band where naive architectures die — usually from Realtime egress or Storage egress bills, not CPU.

- **Storage migration to object store + CDN**
  - Migrate `chat-attachments`, `gallery photos`, `vault-files` from Supabase Storage to **Cloudflare R2 + Cloudflare CDN** (or Bunny). Supabase Storage egress at this band is the #1 cost line.
  - Keep Supabase Storage only for small/private metadata (avatars, logos under 500KB).
  - Backfill script: dual-write for 30 days, then cut reads.
- **Read replicas**
  - Enable Supabase read replica (or move to a dedicated Postgres). Route analytics, leaderboard, season stats, admin pages to replica.
  - Wrap with a `supabaseRead` client; keep writes on primary.
  - Audit for replica-lag-sensitive code (chat send → read-back). Already documented: `jump-cold-start-replica-race.md` — extend that pattern.
- **Realtime — move off `postgres_changes` entirely for chat**
  - All chat messages, reactions, reads broadcast via `realtime.send()` from triggers. Clients subscribe to Broadcast channels scoped per-conversation.
  - Sharding: one channel per `chat_group_id` / `team_id` / `dm_id`. Never global.
  - Presence: shard by club. Global `app-presence` channel is unsafe past ~5k concurrent.
- **Push notifications**
  - Self-host the FCM/APNs sender on a worker queue (Cloudflare Queues, Inngest, or Supabase + pg_cron + edge functions with retries). Add per-device throttling and a quiet-hours table.
  - Add a dead-letter queue for failed sends, daily review.
- **Database**
  - Partition the heaviest tables by month/club: `team_messages`, `notifications`, `message_reads`, `event_views`, `realtime_perf_samples`. Use `pg_partman`.
  - Move append-only telemetry (`realtime_perf_samples`, `event_views`, `event_auto_*_log`) to a cheaper warehouse (Tinybird, ClickHouse, or BigQuery via Supabase webhooks) and purge from Postgres after 30 days.
  - Connection pooling: confirm PgBouncer transaction mode is on; move long-running edge function workloads to session mode pool.
- **Multi-region considerations**
  - Pick a primary region based on user heatmap (AU likely). Add Cloudflare in front of Netlify for global edge caching of static + edge functions.
  - DO NOT split Postgres yet — single primary still fine to 100k MAU.
- **Tenant isolation**
  - Add per-club rate limiting (edge function middleware): protect against one club's misbehaving integration taking down others.
  - Add a `club_health` view: writes/min, push/min, storage GB, so support can see noisy tenants.
- **Compliance**
  - GDPR/CCPA delete-pipeline tested end-to-end (already partially in `data-lifecycle-and-privacy`).
  - SOC2-readiness: audit log table for admin actions.

Cost ceiling target: <$8k/mo (Supabase ~$3k, R2/CDN ~$2k, push ~$500, observability ~$500, misc).

---

## 100,000 → 1,000,000 MAU

Goal: become a proper SaaS platform. At this band, Postgres can still be one cluster if partitioned well — but Realtime, Storage, and Push must be fully externalised.

- **Database**
  - Move to dedicated Postgres (Supabase Enterprise, or self-managed on AWS RDS / Crunchy / Neon). Keep Supabase Auth + Storage + Edge only if pricing makes sense; otherwise split:
    - Auth: keep Supabase Auth OR migrate to WorkOS / Clerk / self-hosted Keycloak.
    - DB: dedicated Postgres with 2+ read replicas, separate analytics replica.
  - Sharding decision point: if any single table >500GB after partitioning, shard by `club_id` across multiple DBs. Add a tenant-router service.
  - Vacuum/autovacuum tuning per table (already a memory: `database/performance-tuning`).
- **Realtime — dedicated service**
  - Replace Supabase Realtime for chat with a purpose-built service: **Ably, Pusher, or self-hosted Centrifugo / Soketi**. Costs at this band: Supabase Realtime is ~$0.001/msg, Ably ~$0.0001, self-hosted Centrifugo on 3x c6g.large ~$200/mo for 10M msg/day.
  - Keep Supabase Realtime only for low-volume admin/dev features.
- **Storage + media**
  - Multi-region R2 / S3 with edge image resizing (Cloudflare Images, imgproxy, or Bunny Optimizer). Never serve original-resolution images to clients.
  - Video: move to Mux or Cloudflare Stream if any video features ship.
- **Push & messaging**
  - Self-hosted notification service (queue + worker) or move to OneSignal / Customer.io for marketing-style pushes. Transactional stays in-house.
  - SMS/email at scale: Postmark / Resend Pro / AWS SES with bounce handling. Email reputation per-tenant.
- **Edge compute**
  - Move latency-sensitive endpoints (auth refresh, chat send, RSVP) to Cloudflare Workers or Deno Deploy edge for sub-50ms global response. Edge function cold starts on Supabase become a bottleneck here.
- **Search**
  - Add Typesense / Meilisearch / Elastic for chat history search, vault search, member directory. Postgres FTS does not scale past ~50M rows for interactive search.
- **Observability**
  - Full APM (Datadog, Grafana Cloud, or Sentry Performance). Per-tenant SLO dashboards.
  - Synthetic monitoring per region: chat send latency, push delivery time, sign-in time.
- **Org structure**
  - Need a platform team (2–4 engineers) owning DB, Realtime, infra. Product feature teams stop touching infra.
  - Incident response: pager rotation, runbooks per subsystem.
- **Cost engineering**
  - Egress is the dominant line. Cache aggressively at CDN. Negotiate Supabase / Cloudflare enterprise contracts.
  - Per-tenant cost reporting; tie to pricing tier.
- **Multi-region (active-active read)**
  - DB writes still single-primary (unless you've sharded by club). Reads served from regional replicas. Chat/Realtime fully regional via dedicated service.

Cost ceiling target: <$70k/mo. Revenue should be 10x+ this to be sustainable.

---

## Decision checkpoints (revisit at each band)

- **5k MAU**: Decide whether to commit to Supabase long-term or plan migration. The longer you wait past 50k, the more painful.
- **25k MAU**: Storage egress audit. If >40% of total bill, migrate to R2 immediately.
- **75k MAU**: Realtime concurrent connection count. If >10k peak, start the Broadcast / dedicated-service migration.
- **250k MAU**: Sharding decision. If any tenant >5% of total load, isolate them on dedicated infra.

## Risks frequently overlooked

1. **Realtime per-message billing** — bills can 10x in a week after a viral club, before you can react.
2. **Storage egress** — media-heavy clubs (galleries, vault) dominate cost long before Postgres does.
3. **Push notification storms** — one badly-timed announcement to 50k users triggers FCM rate limits and a thundering-herd of app-opens that hits realtime + DB simultaneously.
4. **RLS recursion** — every new policy that references another RLS-protected table doubles query cost. Use `SECURITY DEFINER` aggressively.
5. **Single-region latency** — AU-hosted Supabase + global users = 300ms+ chat send. CDN-front everything possible.
6. **Backup restore time** — at 500GB+ DB, a full restore is hours. Test it before you need it.
