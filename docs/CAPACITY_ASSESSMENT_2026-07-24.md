# Ignite Club HQ Capacity Assessment

**Date:** 24 July 2026
**Scope:** Read-only review of the repository and public platform limits. No hosted
database, dashboard, production service, or development service was accessed.

## Executive conclusion

Ignite Club HQ is comfortably sized for its current workload of one club and
about 200 registered users, provided the production project is on at least a
Supabase Pro plan and normal peak concurrency remains below roughly 100 users.

The application does not have a defensible single maximum user count because its
binding limits are concurrent sessions, club-wide realtime fan-out, chat/event
activity, media traffic, database size, and the Supabase plan/compute size—not
the number of registered accounts.

Based on the code:

- **Current 200 registered users:** low capacity risk in normal use.
- **About 1,000 registered users / 200–300 simultaneous users:** likely supportable
  without architectural change on an appropriately configured paid project,
  but monitoring and targeted load tests should be in place.
- **About 2,000–5,000 registered users / 300–1,000 simultaneous users:** achievable,
  but no longer safely “as-is.” Presence, polling, large analytics queries,
  Realtime plan limits, and notification fan-out should be hardened first.
- **10,000+ registered users or 1,000+ simultaneous users:** treat as a planned
  scaling project. Supabase can support it, but the present application design
  should not be assumed to do so without changes and production load testing.

These ranges assume ordinary club usage where 10–25% of registered users may be
online at a busy time. A club-wide event that brings nearly every member online
at once must be sized by the concurrent number instead.

## Confidence and missing production facts

Confidence in the architectural findings is **high**. Confidence in an exact
production ceiling is **low-to-medium**, because this review deliberately did
not inspect the hosted project. The following facts are unknown:

- Supabase plan, spend-cap setting, compute size, disk and pool configuration
- current peak Realtime connections and messages per second
- database size, table cardinalities, query latency, CPU, RAM and I/O utilization
- actual Netlify plan and monthly bandwidth/request use
- actual daily/monthly active users, concurrent users, message rates and media egress

The capacity bands below must therefore be validated against dashboard metrics
before a growth or sales commitment is made.

### Production facts confirmed after the initial review

The project owner subsequently confirmed:

- Supabase Pro with spend cap disabled
- Medium compute
- database size: 1.5 GB
- peak database connections: 64 of 120
- peak CPU: 10%
- Storage size: 1 GB
- Realtime over 28 days: 6,944 requests at 331.85 ms average response speed;
  70,401 presence events; 29,208 Postgres Changes events; zero Broadcast events;
  channel joins averaging 0.2/second with brief peaks around 0.6/second
- Realtime peak connected clients and response errors: not yet available

This improves confidence that CPU, database size and Storage are healthy at the
current workload. Current Realtime throughput is extremely light relative to
the published Pro/no-spend-cap throughput limits. Database connections are
already at 53% of the stated direct limit, so connection attribution and peak
Realtime connected clients are now the two highest-priority measurements. The
64-connection peak must not be assumed to
scale linearly with clubs until fixed platform connections, pooled clients,
Edge Functions and scheduled activity are distinguished.

## Current architecture

### Frontend

- React/Vite single-page application delivered through Netlify.
- Routes are extensively lazy-loaded, which limits the initial route cost.
- Current built output is about 16 MB across all assets. The main JavaScript
  bundle is about 1.04 MB uncompressed / 314 KB gzip; main CSS is about 168 KB
  uncompressed / 27 KB gzip.
- React Query provides caching, with a default 30-second stale time and disabled
  refetch-on-window-focus.
- The frontend talks directly to Supabase Auth, PostgREST, Storage, Edge
  Functions and Realtime. There is no separately scalable application server.

Static CDN delivery should not be the first technical concurrency bottleneck.
Netlify traffic allowances and media bandwidth may create cost/plan thresholds,
but adding application servers is not required merely because user count grows.
The more relevant frontend risks are low-end device performance, the large main
bundle, high-cost lazy chunks, and the number of backend requests a mounted
screen produces.

### Backend

- PostgreSQL/Supabase with row-level security as the authorization boundary.
- 958 historical migrations and at least 441 explicit index declarations.
- 116 Edge Function directories, including notification, email, push, media,
  import/export, engagement and game-day workflows.
- 29 frontend files subscribe to Postgres Changes, with 82 subscription handler
  declarations in total.
- Chat messages are paginated in small pages (15), which is favourable.
- Notification functions generally batch database inserts (often 500 rows) and
  cap push/email concurrency, which is favourable.

The repository contains substantial indexing and batching work, but static
inspection cannot prove that production query plans remain efficient at higher
table cardinalities. That requires synthetic load and `EXPLAIN ANALYZE` against
an isolated representative database.

## Principal scaling constraints

### 1. Realtime concurrent connections

The current Supabase limits are:

| Plan | Concurrent Realtime connections | Messages/second |
|---|---:|---:|
| Free | 200 | 100 |
| Pro with spend cap | 500 | 500 |
| Pro without spend cap | 10,000 | 2,500 |
| Team | 10,000 | 2,500 |

Supabase counts a WebSocket connection, not a registered user. The app normally
uses one multiplexed connection per browser tab or native app session, with
multiple channels on it. Two tabs or devices can therefore make one person count
twice.

Consequences:

- If production were Free, 200 simultaneously connected Riverside sessions
  would meet the published hard limit with no headroom. Even 100–150 people
  using multiple tabs/devices could be uncomfortable.
- On Pro with the ordinary 500-connection limit, an operational alert threshold
  around 350–400 concurrent connections is sensible.
- Raising the platform connection quota does not, by itself, make every current
  Postgres Changes subscription scalable.

### 2. Global presence and database heartbeats

`useUserPresence.ts` creates a global `app-presence` channel shared across all
clubs and sends both a Realtime presence update and a `heartbeat_presence`
database RPC every 25 seconds.

Approximate steady-state database writes:

| Simultaneous active sessions | Heartbeat RPCs/second | Heartbeat writes/day if continuously active |
|---:|---:|---:|
| 50 | 2 | 172,800 |
| 100 | 4 | 345,600 |
| 200 | 8 | 691,200 |
| 500 | 20 | 1,728,000 |
| 1,000 | 40 | 3,456,000 |

These are upserts, so storage growth is modest, but write load, WAL, table churn
and presence state synchronization grow with activity. More importantly, every
club currently participates in the same presence topic. Before hundreds of
simultaneous users across many clubs, presence should be club-scoped (or scoped
to the feature currently visible), paused while backgrounded, and the persistent
heartbeat interval/need should be re-evaluated.

### 3. Postgres Changes fan-out

Supabase authorizes each Postgres change separately for every subscriber and
processes these changes in order. A single write observed by 200 users can cause
about 200 authorization checks/deliveries. Supabase recommends Broadcast rather
than Postgres Changes when roughly 3,000 subscribers watch the same changes.

Ignite uses Postgres Changes for messages, notifications, event/group sync,
pitch/game features and media. This is appropriate at current scale, but
club-wide features can create concentrated fan-out. Filters and indexed RLS
policies are essential. High-fan-out feeds should move to private Broadcast
channels before thousands of users subscribe to the same changes.

### 4. Polling layered on top of Realtime

The app intentionally uses polling as resilience/freshness support:

- 5 seconds for mini-league live game widgets
- 15 seconds for some game/admin/health views
- 30 seconds for event, team, inbox and online-user views
- 45–60 seconds for participants, chat-online counts, headers and scheduled messages

`MessagesPage.tsx` alone declares five recurring queries. The shared unread
count hook notes that a previous implementation generated about 70,000 calls
per day; it has since been deduplicated and slowed, which is a good improvement.

At 500 simultaneous users, a single global 30-second poll is about 16.7 requests
per second. Several concurrent polls on a popular route can multiply this
quickly. Polling should become visibility-aware and fallback-only where
Realtime already provides the primary signal.

### 5. Large client-side analytical reads

`ClubEngagementAnalyticsPage.tsx` contains query limits of 2,000, 5,000, 10,000
and 50,000 rows, including two 50,000-row reads. `AdminActiveGamesPage.tsx` has
a 5,000-row limit, and other components request up to 2,000 rows.

These are not necessarily common user paths, but they will become slow and
expensive as clubs and history grow. Analytics should use server-side aggregate
RPCs/materialized summaries and cursor pagination, rather than transferring
tens of thousands of records to the browser.

### 6. Notification and Edge Function fan-out

The notification implementation has useful safeguards:

- notification inserts are commonly chunked in batches of 500;
- push and email calls use controlled concurrency;
- several recipient lookups are batched.

However, a chat or club event can still create one notification row and
potentially push/email work per recipient. At 200 members this is reasonable.
At thousands of recipients, synchronous Edge Function work risks duration,
retry and downstream-provider rate limits. Supabase hosted Edge Functions have
a 256 MB memory limit, 2 seconds of CPU time per request, and 400-second paid
wall-clock limit. Large fan-out should move to an idempotent queue/worker model.

There are 116 Edge Function directories. Supabase currently permits 100
functions on Free, 500 on Pro, and 1,000 on Team. If all 116 are deployed,
Free would not be sufficient.

### 7. Media and storage

Media capacity is driven more by stored bytes and egress than user count. A few
active clubs uploading video can consume more capacity than thousands of
text-only users. The app already paginates important chat/media views, but
production storage size, transformations, cache headers and egress are unknown.
Set lifecycle/retention rules and track storage/egress per active club before
multi-club expansion.

### 8. Database compute and connections

Supabase's current defaults range from 60 direct / 200 pooled connections on
Nano or Micro to 120 direct / 600 pooled on Medium and 160 / 800 on Large.
Browser PostgREST calls are pooled, and one Realtime WebSocket is not equivalent
to one PostgreSQL connection, so the connection numbers cannot be mapped
directly to users.

Small shared compute can burst and may throttle under sustained load. A compute
upgrade can help normal SQL/RPC/Edge workloads, but it does not meaningfully
remove the single-threaded Postgres Changes authorization constraint.

## Practical capacity bands

These are planning bands, not guarantees.

| Registered users | Busy concurrent sessions | Assessment under current design |
|---:|---:|---|
| 200 | 20–100 typical; up to 200 event peak | **Comfortable on paid Pro.** Free has insufficient headroom for an all-club peak. |
| 500 | 75–200 | **Low-to-moderate risk.** Confirm Pro, peak connections, DB CPU and Realtime messages. |
| 1,000 | 150–300 | **Likely supportable** on paid, correctly sized infrastructure. Run synthetic load tests and remove the worst polling/analytics hotspots. |
| 2,000–5,000 | 300–1,000 | **Changes required before relying on it.** Club-scope presence, tune polling, aggregate analytics, verify RLS indexes, and ensure a 10,000-connection Realtime entitlement where needed. |
| 5,000–10,000 | 750–2,000 | **Planned scale programme.** Medium/Large compute may be required; migrate high-fan-out changes to Broadcast; queue notifications; load-test game-day traffic and media. |
| 10,000+ | 1,500+ | **Not safely claimable as-is.** Platform can scale, but architecture, observability, cost controls and performance tests must be deliberately engineered. |

If usage is unusually synchronized—e.g. every parent opens the same club-wide
game at kickoff—use the concurrent column directly and ignore the registered
user multiplier.

## Recommended trigger points

Do not wait for an outage. Treat any of these as a capacity-review trigger:

- 300 peak Realtime connections on a 500-connection Pro limit
- 60–70% sustained CPU, memory, database connections, IOPS or Realtime throughput
- database/API p95 above 500 ms on core journeys, or p95 writes above 1 second
- Realtime disconnect/timeout growth or events arriving more than 2 seconds late
- more than 250 simultaneous presence users on the global presence channel
- more than 500 daily active users without tested game-day load profiles
- analytics screens regularly reading more than 10,000 rows
- club-wide notification jobs regularly targeting more than 500 recipients
- media egress/storage reaching 70% of its included allowance
- any table approaching a size at which its key RLS-filtered queries no longer
  use indexes

## Recommended work, in priority order

1. **Confirm the production tier and metrics in the dashboard.** Record plan,
   spend cap, compute size, peak Realtime connections/messages, DB CPU/RAM/I/O,
   DB/storage size, egress, Edge invocation duration/errors, and API latency.
2. **Add capacity telemetry and alerts.** Establish 30-day baselines and alerts
   at 60%, 75% and 90% of hard limits.
3. **Build an isolated synthetic load suite.** Model 50, 100, 200 and 500
   simultaneous users across sign-in, inbox, club-wide event RSVP, chat,
   notification receipt and game-day updates. Do not use hosted dev/prod data.
4. **Refactor presence before multi-club scale.** Club-scope the channel, stop
   foreground heartbeats when not needed, and test reconnect storms.
5. **Reduce duplicate polling.** Centralize/deduplicate queries, pause hidden
   screen polling, add exponential backoff, and retain polling only where it
   materially improves resilience.
6. **Move large analytics server-side.** Replace 10,000–50,000-row browser reads
   with aggregate RPCs/materialized summaries and pagination.
7. **Load-test RLS and indexes.** Populate an isolated database with realistic
   synthetic cardinalities, then verify query plans for messages, notifications,
   memberships, event attendance and club/team filters.
8. **Queue large fan-out.** Make notification/email/push jobs idempotent,
   resumable and observable before clubs exceed several hundred recipients.
9. **Plan Broadcast migration.** Use private Broadcast channels for the
   highest-fan-out realtime paths before approaching thousands of shared
   subscribers.
10. **Track cost per active club.** Database, Realtime, storage, egress, Edge
    invocations, email and push traffic should be attributable enough to price
    and forecast growth.

## Overall rating

- **Current Riverside workload:** Green, assuming paid Pro and ordinary peaks.
- **Next 3–5 similarly sized clubs:** Amber-green after confirming plan and
  dashboard headroom; add load testing and telemetry first.
- **10–25 similarly sized clubs:** Amber; complete the presence, polling,
  analytics, notification and Realtime work before committing to service levels.
- **Large multi-club platform:** Technically feasible on Supabase/Netlify, but
  not a zero-change extrapolation of the present design.

The responsible near-term planning ceiling is therefore **about 1,000 registered
users and 200–300 simultaneous users**, subject to production metrics. This is
not a failure ceiling: it is the point at which Ignite should verify capacity
with isolated load tests and complete targeted hardening before further growth.

## Load-test update and club onboarding forecast

**Recorded:** 24 July 2026
**Test environment:** fresh Docker-based local Supabase in the Codespace,
synthetic data only. No hosted development or production system was contacted.

### Evidence obtained

| Test | Outcome |
|---|---|
| 50-user REST/RPC baseline | Passed with zero failures |
| 200-user game-day workload | Passed with zero failures |
| Aggressive 500-user stress workload | Failed at approximately 780 attempted operations/second; local PostgREST/PostgreSQL saturation |
| Realistic 500-session workload | Passed: 16,420 operations, zero failures, read p95 4.1–5.6 ms, RSVP p95 6.6 ms |
| Realistic 1,000-session workload | Passed: 32,813 operations, zero failures, read p95 3.4–4.8 ms, RSVP p95 5.3 ms |
| 200-connection Realtime fan-out | Passed: 2,000/2,000 deliveries, no missing or duplicate events, delivery p95 755 ms |
| 500-connection local Realtime attempt | Inconclusive: blocked by the pinned CLI container's 1,024 open-file limit at approximately 242–243 subscriptions |

The realistic 1,000-session workload averaged approximately 109 operations per
second. PostgreSQL averaged 8.4% local CPU and peaked at 14%; PostgREST averaged
8.8% and peaked at 14%. These measurements demonstrate application correctness
and local headroom for the tested REST/RPC behaviour. They do not certify the
capacity of hosted Supabase Medium compute.

The 500-connection Realtime failure is not classified as an Ignite defect. The
local tenant quota was raised successfully, but the pinned Supabase CLI still
started Realtime with an open-file limit of 1,024. A hosted synthetic performance
project is required to certify Realtime beyond the passing 200-connection local
baseline.

### Revised onboarding forecast

Assumption: approximately 200 registered users per club.

| Clubs | Registered users | Concurrent users at 5% | Planning assessment |
|---:|---:|---:|---|
| 5 | 1,000 | 50 | Strong test confidence |
| 25 | 5,000 | 250 | Safe monitored rollout target |
| 50 | 10,000 | 500 | Likely supportable; validate production peaks |
| 100 | 20,000 | 1,000 | Plausible based on application tests, but requires production metric gates |
| 250 | 50,000 | 2,500 | Dedicated hosted performance validation and infrastructure review required |
| 1,000 | 200,000 | 10,000 | Not yet validated; likely requires staged infrastructure and architecture work |

### Current recommendation

- **Immediate onboarding commitment:** 25 clubs.
- **Reasonable near-term expectation:** 50–100 clubs if monitored production
  behaviour remains healthy.
- **Do not yet commit to:** 250–1,000 clubs without hosted synthetic performance
  testing and staged production evidence.

The recommendation is deliberately more conservative than the successful
1,000-session test because production database connections have already peaked
at 64 of 120. CPU is healthy at a 10% peak, but connection attribution and peak
Realtime connected clients remain unresolved.

### Rollout gates

1. Onboard to 25 clubs.
2. Observe at least two representative game-day periods.
3. Progress to 50 clubs only if:
   - database connections remain below 96 of 120 (80%);
   - core API read p95 remains below 500 ms;
   - core write p95 remains below 750 ms;
   - error rate remains below 1%;
   - Realtime disconnects, timeouts and delivery delays remain low.
4. Apply the same review before progressing to 100 clubs.
5. Use a separate hosted performance project containing synthetic data before
   committing beyond 100–250 clubs.

### Important interpretation

Registered users are not the primary capacity driver. The important variables
are simultaneous sessions, synchronized game-day activity, polling frequency,
Realtime fan-out, notification workloads, media traffic and database
connections. At 1,000 clubs and 5% concurrency, approximately 10,000 users could
be connected simultaneously, reaching the documented Realtime allowance for
Pro without a spend cap and leaving no operational margin.
