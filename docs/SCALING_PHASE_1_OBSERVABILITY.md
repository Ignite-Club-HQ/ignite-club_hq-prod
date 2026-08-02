# Scaling Phase 1 — Capacity Observability

**Delivered:** 24 July 2026
**Scope:** Application-side telemetry contract, privacy/retention hardening,
service objectives, dashboard specification and verification procedure.

No hosted environment is configured by these repository changes. Applying the
included migration and creating hosted alerts remain controlled deployment
actions.

## Capacity objectives

These are the initial service-level indicators for the growth programme:

| Indicator | Target | Warning | Critical |
|---|---:|---:|---:|
| Core API read p95 | <400 ms | >=500 ms | >=1,000 ms |
| Core mutation p95 | <750 ms | >=1,000 ms | >=2,000 ms |
| Realtime delivery p95 | <2 s | >=2 s | >=5 s |
| Authentication success | >=99.9% | <99.9% | <99.5% |
| Edge Function error rate | <0.5% | >=0.5% | >=2% |
| Notification completion | 95% within 60 s | queue age >=60 s | queue age >=5 min |
| Database CPU/RAM/connections/I/O | <60% sustained | >=60% | >=80% |
| Realtime plan utilization | <60% | >=60% | >=80% |
| Cross-club authorization failures | zero | n/a | any confirmed incident |

The API targets apply to the critical journeys: authentication/session refresh,
membership and entitlement loading, event list/detail/RSVP, inbox/chat,
notifications and game-day state.

## Existing repository telemetry

| Source | Purpose | Sampling/trigger | Privacy |
|---|---|---|---|
| `web_vitals` | LCP, CLS, TTFB and INP by route/device | 25% of web page loads | App-admin read only after Phase 1 migration |
| `client_perf_log` | Slow or aborted PostgREST reads | >=5 seconds or timeout; 10-second local throttle | App-admin read only; no query parameters retained |
| `realtime_perf_samples` | Notification/read-receipt delivery latency | 10% of sessions/events, flushed every 30 seconds | App-admin read only; current-user subscriptions only |
| `user_presence` | Active-user approximation by platform | 25-second active-session heartbeat | App-admin operational use |
| Supabase dashboard | DB, API, Auth, Realtime, Edge, Storage and egress | Platform metrics | Restricted operator access |
| Netlify dashboard | deploy, CDN requests, bandwidth and errors | Platform metrics | Restricted operator access |
| Native Crashlytics | native crashes and boot failures | Native runtime | Restricted operator access |

Telemetry must never include message text, event notes, names, email addresses,
media URLs, auth tokens, request query strings or service-role credentials.

## Repository hardening in this phase

- Realtime read-receipt sampling is filtered to the current user instead of
  subscribing to every `message_reads` insert.
- Client pending samples are bounded at 100 so monitoring cannot create an
  unbounded memory queue during an outage.
- Cross-club Web Vitals access is removed from club admins; only app admins may
  inspect platform-wide telemetry.
- `purge_old_capacity_telemetry(retention_days)` provides bounded retention for
  all three client telemetry tables. It is service-role-only and rejects values
  outside 7–365 days.

## Dashboard specification

Create one restricted **Capacity** dashboard with these panels:

### Traffic and concurrency

- DAU/MAU and new users
- concurrent Realtime connections: current, p95 and maximum
- Realtime messages/second and joins/second
- active heartbeats by platform
- API requests/second split by REST, RPC, Auth, Storage and Functions

### User experience

- Web Vitals p50/p75/p95 by route and platform
- slow reads by `query_name`, count and p50/p95 duration
- aborted reads by route/network type
- Realtime delivery p50/p95/p99 by channel
- native crash-free sessions

### Database

- CPU, memory, direct/pooler connections
- disk size, IOPS, throughput and WAL
- API p50/p95/p99 latency and 4xx/5xx rates
- slowest normalized queries and total execution time
- lock waits, deadlocks, cache hit rate and index/bloat indicators

### Edge and fan-out

- invocation count, p50/p95 duration and 4xx/5xx by function
- notification recipients/job and processing duration
- push/email success and retry counts
- scheduled-job duration and overlapping executions

### Storage and cost

- database/storage size and growth per day
- storage and CDN egress
- Realtime messages and peak connections against quota
- Edge invocations against quota
- forecasted month-end utilization and cost

## Initial alerts

Configure alerts against the actual purchased plan—not a hard-coded assumption:

1. Realtime peak connections at 60%, 75% and 90% of quota.
2. Realtime message rate at 60%, 75% and 90% of quota.
3. Database CPU, memory, connections, IOPS or throughput above 60% for 15
   minutes; critical above 80% for 10 minutes.
4. Core API p95 above 500 ms for 15 minutes; critical above 1 second.
5. Realtime p95 above 2 seconds for 10 minutes.
6. Edge Function 5xx >=2% over 10 minutes, or p95 duration doubles from its
   30-day baseline.
7. Storage, database size or egress above 70% of included allowance.
8. Authentication failure rate above 0.5% after excluding known invalid
   credentials.
9. Telemetry stops arriving for an hour during an otherwise active period.

Alerts should go to an owned operational channel and have a named responder.

## Retention

- Default client telemetry retention: 30 days.
- Keep aggregated daily percentiles/counts for 13 months if trend history is
  needed; do not keep raw user-level rows for that purpose.
- Run `purge_old_capacity_telemetry(30)` daily using the controlled hosted cron
  mechanism after the migration is approved and deployed.
- Review who can access raw telemetry quarterly.

## Production facts still requiring operator confirmation

Record these in the capacity register:

- Supabase plan and spend-cap setting
- compute size, direct/pooler connection limits and disk configuration
- Realtime connection/message/join limits
- current 30-day peaks for every limit
- database, Storage and egress usage
- Netlify plan, requests and bandwidth
- email and push provider quotas
- production MAU, DAU and peak concurrent sessions

Repository inspection cannot safely establish those hosted facts.

## Confirmed production capacity register — 24 July 2026

These values were supplied by the project owner; the repository review did not
connect to the hosted project.

| Item | Confirmed value | Initial assessment |
|---|---:|---|
| Supabase plan | Pro | Suitable starting tier |
| Spend cap | Disabled | 10,000 published Realtime connection allowance; overage charges possible |
| Compute | Medium | Suitable for current and early multi-club workload |
| Database size | 1.5 GB | 18.75% of 8 GB included Pro database quota |
| Peak direct DB connections | 64 / 120 | 53.3%; first amber capacity signal |
| Peak CPU | 10% | Strong headroom |
| Storage size | 1 GB | Strong headroom against 100 GB included Pro Storage quota |
| Realtime peak connections | Unknown | Still required before setting an onboarding ceiling |
| Realtime total requests | 6,944 over 28 days | ~248/day; light current usage |
| Realtime average response speed | 331.85 ms over 28 days | Acceptable average; p95/peak still required |
| Presence events | 70,401 over 28 days | ~2,514/day or 0.029/sec average |
| Postgres Changes events | 29,208 over 28 days | ~1,043/day or 0.012/sec average |
| Broadcast events | 0 over 28 days | Confirms current design uses no Broadcast |
| Channel join rate | 0.2/sec average; ~0.6/sec brief peaks | Negligible versus 2,500/sec limit |

### Interpretation

CPU, database size and Storage do not currently justify a compute upgrade.
Connection use requires attribution before onboarding at scale. A 64-connection
peak may include fixed platform/services, pooled application traffic, Edge
Functions, scheduled jobs or a short-lived deployment/maintenance event; it
must not be extrapolated linearly from one club without identifying its source.

The immediate dashboard work is:

1. Confirm whether 64/120 is the direct Postgres metric and separately record
   Supavisor pooled client connections.
2. Break connections down by database role/application and compare an idle
   period, ordinary peak and game-day peak.
3. Record connection duration, waiting queries and pool saturation—not just the
   maximum count.
4. Capture Supabase Realtime peak connections, messages/second and joins/second.
5. Alert at 72, 90 and 108 direct connections (60%, 75% and 90% of 120).

The 28-day Realtime figures currently show substantial throughput headroom.
However, an average response speed does not establish p95 latency, and total
event averages do not reveal synchronized game-day bursts. The remaining
Realtime facts required are maximum **Connected Clients**, maximum event rate,
response-error count/rate and any p95/maximum response-speed view available.

### Locating Realtime reports in the current dashboard

Supabase documentation currently describes this as **Project Settings → Product
Reports → Realtime**, but some dashboard versions do not expose that menu.

Use either:

- the project sidebar's **Reports** or **Observability** section, then
  **Realtime**; or
- while viewing the project, replace the path after
  `/dashboard/project/<your-project-ref>/` with `reports/realtime`.

This produces:

`https://supabase.com/dashboard/project/<your-project-ref>/reports/realtime`

Do not share the project reference or any dashboard credentials when reporting
the resulting aggregate figures.

## Acceptance checklist

- [ ] Focused telemetry unit tests pass.
- [ ] Existing baseline suite remains green.
- [ ] Migration reviewed and deployed through the normal promotion process.
- [ ] Retention call scheduled and its result logged.
- [ ] Capacity dashboard created with restricted access.
- [ ] 60/75/90% alerts tested using synthetic alert events.
- [ ] Thirty days of measurements collected.
- [ ] Capacity assumptions updated from observed p95 and peak values.

Phase 1 is operationally complete only when the repository changes **and** the
hosted dashboard/alerts have been applied and verified by an authorized
operator.
