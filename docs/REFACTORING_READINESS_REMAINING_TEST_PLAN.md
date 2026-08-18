# Ignite Club HQ — Remaining Refactoring-Readiness Test Plan

**Status:** Canonical plan
**Established:** 30 July 2026

This is the plan to use when deciding which refactoring-readiness tests to design next. It supersedes conversational summaries and older ordering recommendations for the remaining work.

Testing should protect production behaviour and expose genuine defects. Do not add tests solely to increase coverage, and do not change production behaviour while constructing a test bundle unless a separately reviewed fix is explicitly requested.

## 1. Notification fan-out and delivery reliability

This is the next testing bundle.

**Bundle status (30 July 2026):** Constructed, fixed in main and verified on
`codespaces-review`. The combined focused suites now contain 63 passing
tests (34 characterization cases plus 29 dedicated pagination/failure cases).
This bundle is green and section 2 may proceed after the test changes are
committed.

Resolved contracts:

- mini-league recipient resolution truncates above the PostgREST row cap;
- targeted-event guardian discovery truncates child assignments above the
  PostgREST row cap;
- team membership read failures are treated as an empty audience;
- mini-league membership read failures are treated as an empty audience;
- targeted child-assignment read failures produce a partial audience;
- targeted guardian-relation read failures produce a partial audience.

The existing queue tests already cover large notification/queue insertion,
atomic notification-plus-job creation, retry deduplication, bounded claiming,
stale-job recovery and terminal delivery states. The added middle-batch test
also confirms that committed independent batches are counted accurately when
one batch fails.

Cover:

- large-recipient events and recipient pagination beyond common 20- or 30-row limits;
- exactly one notification for every eligible recipient;
- duplicate prevention across retries, repeated invocations and overlapping recipient groups;
- retry and idempotency behaviour;
- partial batch and provider failures without losing unaffected recipients;
- push-delivery queue creation and processing;
- distinction between in-app notification creation and actual push delivery;
- club, team and role targeting and isolation;
- excluded, ineligible, opted-out or otherwise unreachable recipients;
- club-wide events targeting multiple specific teams;
- preservation of existing single-team event behaviour;
- observable and accurate reporting of partial or complete delivery failures.

Prefer local Supabase integration tests for recipient selection, database mutations, queueing and idempotency. Use focused unit tests for pure batching or deduplication rules, and Playwright only for the important user-visible creation and status journey.

## 2. Realtime lifecycle and recovery

**Bundle status (30 July 2026):** Constructed, fixed in main and verified on
`codespaces-review`. The focused presence, channel-registry,
authorization-scope and native resume/reconnect suites now contain 34 passing
tests across five files. This bundle is green and section 3 may proceed.

Resolved contracts:

- `useOnlineCount` counts duplicate input user IDs more than once;
- a delayed error/closed callback from a replaced presence channel can tear
  down and recreate the current user's healthy channel;
- a delayed subscribed callback from a replaced channel can track the new
  user and install a heartbeat through the obsolete callback.

Cover:

- subscription setup and teardown;
- reconnection after interruption, app resume and authentication refresh;
- membership or permission loss while connected;
- prevention of duplicate events and duplicate channels after reconnect;
- stale-cache reconciliation;
- partial network failure and recovery;
- bounded invalidation and refetch behaviour;
- cleanup of channels, listeners and timers.

## 3. Multi-step mutation failure recovery

**Bundle status (31 July 2026):** Constructed, fixed in main and verified on
`codespaces-review`. The expanded guardian-invite suite now has 20 passing
cases, and the adjacent team-member, guardian-management and season-invite
suites remain green (48 passing cases across four files). This bundle is green
and section 4 may proceed.

Resolved contracts:

- a failed authoritative team-to-club scope lookup is ignored, allowing a
  pending guardian invite to be created with `club_id = null` and success UI;
- a transport/function error from `send-email` is ignored and
  `email_sent_at` is recorded despite no verified delivery;
- an unverified/unsuccessful provider response is also recorded and displayed
  as successful email delivery.

Cover:

- failure at each meaningful step of a multi-operation workflow;
- safe retry and idempotency;
- no false success messages;
- no orphaned or incorrectly deleted records;
- preservation of completed independent work when appropriate;
- accurate partial-failure reporting;
- concurrent requests and duplicate submissions;
- transactional boundaries for security-sensitive workflows.

## 4. Edge Function contracts and failure handling

**Bundle status (31 July 2026):** Green after the payment-handler fixes from
main. All 19 payment security contracts pass. The combined payment, Edge
Function governance, source-validation, shared entitlement guard, high-risk
handler, Stripe webhook and related chat-routing bundle passes 164/164 tests.
Independent esbuild checks also confirm that `confirm-event-payment`,
`create-event-checkout` and `cancel-subscription` all parse and bundle.

The payment tests now exercise the extracted pure verification and redirect
helpers directly, including authoritative amounts, event/user/club identity,
paid-state rejection and approved-origin enforcement. Source contracts retain
coverage of handler composition, authorization failure handling, atomic
recording/idempotency, sanitized errors and cancellation ordering. No hosted
Supabase project or external payment provider was contacted.

Cover:

- authentication and authorization boundaries;
- strict input validation;
- club, team and organisation isolation;
- external-provider failure and timeout handling;
- retry and idempotency behaviour;
- pagination and batching where applicable;
- safe error responses without secrets or sensitive data;
- consistency between Edge Function expectations and database policies/functions.

## 5. Final refactoring-readiness review

After the four bundles above:

1. Map the completed tests to each high-maintenance domain.
2. Identify only material behavioural gaps.
3. Run all affected suites and the complete one-click baseline.
4. Record defects separately from test-infrastructure problems.
5. Produce a domain-by-domain assessment of:
   - safe to refactor;
   - safe only within defined boundaries;
   - additional protection required first.

## Already substantially protected

The main characterization bundles already cover messaging, events, membership administration, team and club read models, Vault and media, season rollover, competition workflows, notifications at the UI/routing level, and AutoSub/PitchBoard. These areas should not receive more tests unless the final review identifies a material behavioural gap or a new feature changes their risk profile.

## Safety constraints

- Use only the isolated local Supabase stack for database and infrastructure tests.
- Never connect tests to hosted development or production databases.
- Use synthetic users, clubs, teams and events only.
- Keep production behaviour unchanged while designing tests.
- Explain genuine defects before any production fix.
- Add completed bundles to the one-click baseline only after they are stable.
