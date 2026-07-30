# Isolated Local Load Testing

This Phase 2 harness measures request amplification, RLS/query behaviour,
concurrency correctness and relative latency using synthetic data. It does not
claim to reproduce Supabase Medium compute or internet latency inside a
Codespace.

## Safety contract

- The only accepted API target is `http://127.0.0.1:54321` (or the equivalent
  loopback host) on the fixed local port.
- Hosted Supabase environment variables are stripped by the baseline runner.
- API keys are discovered from the newly created local Kong container.
- The database marker must confirm
  `ignite-club-local-security-tests` before data creation.
- All club names, users, events, notifications and RSVP records are synthetic.
- Profiles are bounded to at most 500 virtual users, 1,000 synthetic users,
  1,000 club rows and three minutes.
- The existing allowlisted cleanup removes only the isolated local containers
  and volumes and verifies that none remain.
- The harness does not accept a database URL, password, hosted project
  reference, access token or arbitrary target URL.

## Profiles

| Profile | Virtual users | Duration | Active clubs | Users/active club | Total club cardinality |
|---|---:|---:|---:|---:|---:|
| `smoke` | 5 | 15s | 2 | 5 | 25 |
| `baseline` | 50 | 60s | 10 | 20 | 100 |
| `gameday` | 200 | 120s | 25 | 20 | 500 |
| `authstorm` | 200 | 120s | 25 | 20 | 500 |
| `scale` | 500 | 180s | 50 | 20 | 1,000 |
| `realistic500` | 500 | 300s | 50 | 20 | 1,000 |
| `realistic1000` | 1,000 | 300s | 50 | 20 | 1,000 |
| `realtime500` | 500 sockets | 120s ceiling | 50 | 20 | 1,000 |

Dormant club rows increase tenant cardinality without creating unrealistic
numbers of local Auth accounts. Virtual users are distributed over authenticated
synthetic accounts in active clubs.

The `scale` profile introduces its 500 virtual users evenly over 120 seconds,
then holds all 500 active for 60 seconds. This distinguishes gradual sustained
load from the deliberately unrealistic instantaneous connection shock.

The `realistic500` profile introduces 500 established authenticated sessions
over 180 seconds, then holds all sessions for 120 seconds. Each session waits
3–10 seconds between actions and does not repeatedly sign in during the
workload. This models a busy interactive period; `scale` remains the deliberately
aggressive stress/regression profile.

`realistic1000` uses the same pacing and arrival curve with all 1,000 synthetic
accounts active. It is the maximum declared local session profile and remains
bounded to 1,000 synthetic users and 1,000 club rows.

`realtime500` is a separate WebSocket profile. It opens 500 authenticated
Postgres-change subscriptions across all 50 active clubs over 60 seconds, then
emits ten controlled event-update waves. It measures joins, expected fan-out,
delivery latency, missing and duplicate messages, and explicit channel cleanup.
After the synthetic local marker is confirmed, this profile alone raises the
sole fresh `_realtime.tenants` connection ceiling from its self-hosted default
of 200 to 600. The runner requires the update result to be exactly one tenant at
600 or it aborts before fixture creation. The adjustment exists only in the
ephemeral local database removed by the lifecycle; no hosted setting is read or
changed. The metadata-owner connection uses the fixed local Docker development
password `postgres`; it does not read a password or URL from the workspace
environment.

The pinned CLI creates Realtime with an empty `RLIMIT_NOFILE`, leaving the
container at 1,024 open files. Diagnostic runs consistently admitted 242–243
subscriptions after the tenant ceiling was raised, then returned channel errors
and could no longer complete the fan-out writes. The CLI uses the Docker API
directly, so a PATH-scoped Docker wrapper cannot alter that container setting.
The local CLI stack therefore cannot validly certify 500 simultaneous Realtime
connections without replacing its container orchestration, which is outside
this safe baseline harness.

## Workload mix

- 25% membership/RLS reads
- 25% club event reads
- 15% Pro entitlement RPCs
- 15% notification inbox reads
- 15% RSVP mutations
- 5% password authentication for smoke/baseline and the explicit `authstorm`
- 1% password authentication for game-day/scale steady-session traffic

Stress profiles wait 100–300ms between actions. `realistic500` waits 3–10
seconds and authenticates each synthetic account once during fixture setup.

## Initial gates

- error rate below 1%
- combined read p95 below 500ms
- RSVP mutation p95 below 750ms
- authentication p95 below 1,000ms

These gates are regression signals for the local stack. They are not a
production capacity certification.

## Execution

The load stage is optional and reuses the complete baseline lifecycle:

```text
npm run test:load:local -- --approved-local-session --load-profile=smoke
```

Replace `smoke` with `baseline`, `gameday`, `authstorm` or `scale` only after the previous
profile passes. The exact command must be shown and approved before each local
Supabase run.

While developing uncommitted load-test changes, use the dedicated lifecycle
instead of weakening the complete baseline's clean-worktree preflight:

```text
npm run test:load:local:session -- --approved-local-session --profile=smoke
```

It starts the same allowlisted local stack, discovers generated local keys,
verifies the database marker, runs one bounded profile and removes/verifies all
allowlisted containers and volumes.

Each execution writes its aggregate result to
`test-results/local-load/<profile>-latest.json`. Known socket-error console
noise is suppressed, but every failed request and nested transport error code
remains counted in that report.

While the workload runs, the lifecycle also samples CPU, memory, network I/O,
block I/O and process counts for the allowlisted local Supabase containers every
five seconds. Samples are written to
`test-results/local-load/<profile>-resources.jsonl`; no hosted metrics or
credentials are read.

## Interpretation

A failure can mean:

- an RLS/query/index path degrades with tenant cardinality;
- concurrent writes conflict or fail;
- local Auth, PostgREST or PostgreSQL saturation;
- the Codespace itself is resource constrained.

Before changing production code, reproduce the failure, inspect local container
CPU/memory and query plans, and determine whether the bottleneck belongs to the
application or the local host.

Production-scale certification ultimately requires a separate hosted
performance environment containing synthetic data. The local harness must never
be redirected to development or production.

## Recorded results

### Smoke — 24 July 2026

Configuration: 5 virtual users for 15 seconds, 2 active clubs, 10 authenticated
synthetic users and 25 total club rows.

| Operation | Count | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Authentication | 14 | 121.3ms | 186.3ms | 186.3ms |
| Entitlement RPC | 53 | 3.0ms | 12.1ms | 86.2ms |
| Event read | 84 | 3.8ms | 6.2ms | 7.8ms |
| Membership read | 111 | 2.7ms | 9.5ms | 70.8ms |
| Notification read | 58 | 2.8ms | 8.8ms | 95.9ms |
| RSVP mutation | 48 | 4.0ms | 7.6ms | 11.0ms |

- Total operations: 368
- Failures: 0
- Error rate: 0.00%
- All initial gates passed.
- Verified cleanup removed every allowlisted local container and volume.

Interpretation: the lifecycle, synthetic fixtures, RLS paths, concurrent RSVP
writes, measurement and cleanup work correctly at smoke scale. This result does
not yet establish an onboarding ceiling; the 50-VU baseline and 200-VU game-day
profiles are required next.

### Baseline — 24 July 2026

Configuration: 50 virtual users for 60 seconds, 10 active clubs, 200
authenticated synthetic users and 100 total club rows.

| Operation | Count | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Authentication | 700 | 226.9ms | 559.3ms | 693.3ms |
| Entitlement RPC | 2,017 | 4.4ms | 17.9ms | 37.8ms |
| Event read | 3,362 | 6.3ms | 22.1ms | 41.5ms |
| Membership read | 3,407 | 4.2ms | 16.9ms | 30.2ms |
| Notification read | 1,999 | 4.5ms | 16.8ms | 40.6ms |
| RSVP mutation | 2,070 | 5.7ms | 22.0ms | 55.2ms |

- Total operations: 13,555
- Approximate sustained rate: 225.9 operations/second
- Failures: 0
- Error rate: 0.00%
- All initial gates passed.
- Verified cleanup removed every allowlisted local container and volume.

Interpretation: membership RLS, event listing, entitlement checks,
notifications and concurrent RSVP mutations retain low latency at 50 VUs and
100-club cardinality on the local host. Authentication p95 rose from 186.3ms in
smoke to 559.3ms under baseline concurrency but remains below the 1,000ms gate.
The 200-VU game-day profile is the next required saturation point.

### Game-day plus aggressive authentication — 24 July 2026

The first `gameday` execution used the original 5% repeated-authentication mix,
which is now retained explicitly as the `authstorm` profile. Configuration: 200
virtual users for 120 seconds, 25 active clubs, 500 authenticated synthetic
users and 500 total club rows.

| Operation | Count | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Authentication | 1,751 | 8,053.6ms | 9,526.8ms | 10,070.3ms |
| Entitlement RPC | 5,486 | 50.7ms | 398.0ms | 841.6ms |
| Event read | 9,103 | 69.2ms | 407.2ms | 763.6ms |
| Membership read | 9,106 | 48.1ms | 385.0ms | 741.7ms |
| Notification read | 5,527 | 46.9ms | 384.3ms | 745.3ms |
| RSVP mutation | 5,507 | 64.5ms | 406.6ms | 783.9ms |

- Total operations: 36,480
- Failures: 132
- Error rate: 0.36%
- Read, write and overall error-rate gates passed.
- Authentication p95 gate failed: 9,526.8ms versus 1,000ms.
- Verified cleanup removed every allowlisted local container and volume.

Interpretation: core RLS reads and RSVP mutations remained within their gates
under heavy concurrency. Repeated sign-in traffic saturated the local Auth
service. Because normal Ignite sessions persist and refresh rather than signing
in every few actions, this does not by itself establish a production defect.
The failed condition remains as `authstorm`; the realistic game-day mix now
uses 1% authentication. Failure reporting was also expanded to identify the
operation and error code for future non-zero results.

### Corrected game-day — 24 July 2026

Configuration: 200 virtual users for 120 seconds, 25 active clubs, 500
authenticated synthetic users, 500 total club rows and a 1% authentication mix.

| Operation | Count | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Authentication | 734 | 388.0ms | 705.4ms | 935.6ms |
| Entitlement RPC | 11,740 | 80.4ms | 357.0ms | 634.2ms |
| Event read | 19,457 | 84.4ms | 357.0ms | 589.6ms |
| Membership read | 19,661 | 79.1ms | 344.0ms | 589.9ms |
| Notification read | 11,650 | 78.9ms | 343.2ms | 566.2ms |
| RSVP mutation | 11,630 | 82.6ms | 355.0ms | 606.7ms |

- Total operations: 74,872
- Approximate sustained rate: 623.9 operations/second
- Failures: 0
- Error rate: 0.00%
- Every latency and reliability gate passed.
- Verified cleanup removed every allowlisted local container and volume.

Interpretation: the tested membership/RLS, event, entitlement, notification,
RSVP and authentication paths remained stable under 200 concurrent
persisted-session virtual users. This supports the current five-club onboarding
gate and provides positive evidence for a later 10–25-club gate, subject to
production connection and game-day monitoring. It is not a certification of
Supabase Medium production capacity because the local host and synthetic schema
are not identical to the hosted production system.

### Ramped scale — 24 July 2026

Configuration: 500 virtual users introduced evenly over 120 seconds, followed
by a 60-second full-load hold; 50 active clubs, 1,000 authenticated synthetic
users, 1,000 total club rows and a 1% authentication mix.

| Operation | Count | Failures | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| Authentication | 1,391 | 430 | 322.7ms | 687.9ms | 866.3ms |
| Entitlement RPC | 21,812 | 7,205 | 106.9ms | 646.6ms | 1,091.1ms |
| Event read | 36,547 | 12,147 | 108.2ms | 649.6ms | 1,096.4ms |
| Membership read | 36,571 | 12,157 | 104.7ms | 640.1ms | 1,081.1ms |
| Notification read | 21,996 | 7,156 | 108.0ms | 651.3ms | 1,076.9ms |
| RSVP mutation | 22,169 | 7,258 | 114.6ms | 666.8ms | 1,108.1ms |

- Total operations: 140,486
- Failures: 46,353
- Error rate: 32.99%
- Reliability and read-latency gates failed.
- Write and authentication latency gates passed for measured requests.
- During the workload window, local PostgREST CPU averaged approximately 68%
  and peaked at 94%; PostgreSQL averaged approximately 78% and peaked at 101%.
- Container memory remained low.
- Failures were distributed proportionally across all REST-backed business
  operations and were overwhelmingly `fetch failed` transport errors.
- Verified cleanup removed every allowlisted local container and volume.

Interpretation: gradual arrival avoids the immediate console flood from the
original all-at-once run, but the single Codespace Docker stack still cannot
reliably sustain the 500-VU workload. The broad failure distribution and local
PostgREST/PostgreSQL CPU pressure identify a local service/host saturation
boundary rather than a defect in one Ignite business workflow. The passing
200-VU result and failing 500-VU result establish a useful local bracket; they
do not establish the capacity of hosted Supabase Medium compute. Narrowing the
local breakpoint requires stepped 250/300/350/400-VU profiles. Certifying
production-scale capacity requires a separate synthetic hosted performance
project and must never use development or production.

### Realistically paced 500 sessions — 24 July 2026

Configuration: 500 authenticated sessions distributed across all 50 active
clubs, introduced over 180 seconds and held together for 120 seconds; 1,000
synthetic users and club rows, with 3–10 seconds between actions. Authentication
was performed once during fixture setup rather than repeated in the measured
workload.

| Operation | Count | Failures | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| Entitlement RPC | 2,544 | 0 | 2.4ms | 4.4ms | 7.2ms |
| Event read | 4,380 | 0 | 3.3ms | 5.6ms | 9.2ms |
| Membership read | 4,293 | 0 | 2.2ms | 4.1ms | 8.2ms |
| Notification read | 2,594 | 0 | 2.4ms | 4.3ms | 7.9ms |
| RSVP mutation | 2,609 | 0 | 3.2ms | 6.6ms | 10.7ms |

- Total operations: 16,420
- Approximate average rate across the ramp and hold: 54.7 operations/second
- Failures: 0
- Error rate: 0.00%
- Every applicable reliability and latency gate passed.
- During the measured workload, local PostgreSQL CPU averaged approximately 5%
  and peaked at 11%.
- Local PostgREST CPU averaged approximately 4.7% and peaked at 7.6%.
- Local Auth CPU averaged approximately 1%; Kong averaged approximately 2.7%.
- Container memory remained low.
- Verified cleanup removed every allowlisted local container and volume.

Interpretation: all tested business paths remained correct and responsive with
500 realistically paced, established sessions on the isolated local stack.
Together with the aggressive 500-VU failure, this demonstrates that request
rate and user behaviour—not the raw number of session objects—determine the
local boundary. It provides useful application confidence but is not a hosted
Supabase Medium capacity certification and does not include Realtime socket
fan-out, file traffic or Edge Function load.

### Realistically paced 1,000 sessions — 24 July 2026

Configuration: all 1,000 authenticated synthetic accounts active across 50
clubs, introduced over 180 seconds and held together for 120 seconds, with
3–10 seconds between actions. Authentication was established during fixture
setup and was not repeated in the measured workload.

| Operation | Count | Failures | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| Entitlement RPC | 5,056 | 0 | 2.1ms | 3.7ms | 7.1ms |
| Event read | 8,666 | 0 | 3.0ms | 4.8ms | 8.1ms |
| Membership read | 8,760 | 0 | 1.9ms | 3.4ms | 6.1ms |
| Notification read | 5,140 | 0 | 2.2ms | 3.9ms | 7.5ms |
| RSVP mutation | 5,191 | 0 | 2.9ms | 5.3ms | 9.8ms |

- Total operations: 32,813
- Approximate average rate across the ramp and hold: 109.4 operations/second
- Failures: 0
- Error rate: 0.00%
- Every applicable reliability and latency gate passed.
- During the measured workload, local PostgreSQL CPU averaged approximately
  8.4% and peaked at 14%.
- Local PostgREST CPU averaged approximately 8.8% and peaked at 14%.
- Local Kong CPU averaged approximately 5.4%; Auth averaged approximately 1%.
- Container memory remained low.
- Verified cleanup removed every allowlisted local container and volume.

Interpretation: the tested REST/RPC business paths remained correct and
responsive with 1,000 realistically paced established sessions in the isolated
Codespace stack. Throughput nearly doubled from the 500-session run without
material latency degradation or resource pressure. This strengthens the
application baseline but does not certify hosted production capacity and does
not exercise 1,000 Realtime sockets, fan-out delivery, file transfers or Edge
Functions.

### Realtime 500-connection attempt — 24 July 2026

Configuration: 500 authenticated Postgres-change subscription attempts
distributed across 50 active synthetic clubs over 60 seconds, followed by ten
event-update fan-out waves.

| Metric | Result |
|---|---:|
| Attempted connections | 500 |
| Successful subscriptions | 200 |
| Subscription failures | 300 |
| Expected deliveries to admitted connections | 2,000 |
| Received deliveries | 2,000 |
| Missing deliveries | 0 |
| Duplicate deliveries | 0 |
| Delivery rate | 100.00% |
| Delivery p50 | 661.6ms |
| Delivery p95 | 755.0ms |
| Delivery p99 | 761.9ms |

- The connection-success gate failed; every excess connection received
  `CHANNEL_ERROR`.
- Every admitted connection received every expected authorized event.
- All delivery-latency, delivery-rate and duplicate-delivery gates passed.
- Local Realtime CPU averaged approximately 5.8% and peaked below 10%.
- Container memory remained low.
- Verified cleanup removed every attempted channel and every allowlisted local
  container and volume.

Interpretation: the exact 200-connection cutoff matches Supabase Realtime's
documented default `TENANT_MAX_CONCURRENT_USERS=200` for a newly created
self-hosted tenant. It is a local test-configuration ceiling, not application
failure or resource exhaustion. A true 500-connection local capacity run
requires increasing only the freshly created isolated tenant limit above 500,
then rerunning this unchanged workload. Hosted project limits must not be read
or changed as part of that work.
