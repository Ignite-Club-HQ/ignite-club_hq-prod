# Promotion dependency manifest — 2026-08-18

## Snapshot

- Source branch: `integrate/competition-current`
- Source commit: `a23f74c45a47f65301b19a0a241ec5ada110d17a`
- Comparison base: `origin/main` at
  `0fdd85016736c461dbd8cfa706c8b4b1e96a806d`
- Changed paths in comparison: 746
- Status: manifest only; no tranche branch created and nothing merged or deployed

The source and base SHAs must be recorded again immediately before tranche
construction. If either moves, regenerate the comparison rather than assuming
this snapshot is still exact.

## Correct cumulative order

| Order | Tranche | Must follow | Reason |
| --- | --- | --- | --- |
| 00 | Test and release governance | — | Establishes isolated baseline, guards and evidence without application behaviour |
| 01 | Shared runtime foundations | 00 | Auth, entitlement, lifecycle, error and query contracts are consumed by later domains |
| 02 | Membership, roles and invitations | 01 | Establishes users, clubs, teams, guardians and role semantics used by every later domain |
| 03 | Events and Home read models | 02 | Events consume membership/role scope; PitchBoard attaches to events |
| 04 | Competition fixtures and ladders | 02 | Competition consumes auth/roles and shared scheduling, but is otherwise separable from events |
| 05 | Messaging and notifications | 01, 02 | Inbox visibility and notification routing depend on entitlement, profile and membership scope |
| 06 | Vault and Media | 02, 05 | Vault/Media use role scope; chat-to-Vault delivery and chat-image publication require messaging contracts |
| 07 | PitchBoard, timer and AutoSub | 02, 03, 05 | Uses team/event identity and notification recipient policy |
| 08 | Telemetry and release closeout | 00–07 | Cross-cutting policy, native configuration and release evidence should be reviewed against the final cumulative candidate |

Tranches 03 and 04 may be reviewed in parallel after 02, but their accepted
integration order must still be recorded. Tranches 05 and 06 are not safely
reversible in order because Vault contains messaging integration points.

## Exact ownership rules

These rules are mutually exclusive after applying the explicit exceptions
below. Each production file, its characterization/contract tests, relevant
Playwright journey, and local-Supabase parity fixture travel together.

### 00 — Test and release governance

Own only non-runtime assets:

- `.github/CODEOWNERS`
- `.github/pull_request_template.md`
- `.github/workflows/codespaces-review-baseline.yml`
- test-only configuration (`playwright.baseline.config.ts`,
  `vitest.integration.config.ts`, `vitest.local-supabase.config.ts`)
- local baseline/load orchestration beneath `scripts/`
- `tests/`, `e2e-baseline/`, and `local-supabase-workspace/`
- test files colocated under `src/` and `supabase/functions/`
- testing, handover and promotion documentation

Exceptions: a test that imports a newly extracted production module cannot land
before that module. Move that test into the module's owning tranche. The local
Supabase workspace is synthetic and never deployable.

### 01 — Shared runtime foundations

Explicit production ownership:

- `src/hooks/useAuth.tsx`
- `src/hooks/useClubFreeUsage.ts`
- `src/hooks/useClubProAccess.ts`
- `src/lib/proEntitlement.ts`
- `src/components/RouteErrorBoundary.tsx`
- `src/components/layout/AppHeader.tsx`
- shared profile/member identity, cache, lifecycle, navigation and query-key
  modules consumed by more than one later tranche
- `package.json`, `package-lock.json`, and `deno.lock`
- production TypeScript configurations

Dependency/security changes must be reviewed separately inside this tranche;
their presence does not authorize an unrelated application change.

### 02 — Membership, roles and invitations

Own:

- `src/features/membership/**`
- membership, invite, role, guardian, child, season and team-administration UI
- invite signup/deep-link handoff and active-club selection
- team/club lifecycle and role mutation boundaries

Explicit overlapping ownership:

- `src/components/PendingInviteWelcomeDialog.tsx` belongs here, not Vault/Media.
- `src/features/events/scheduleMembershipPolicy.ts` belongs here because it
  defines membership visibility consumed by Events.
- `src/features/notifications/membershipNotificationRepository.ts` and
  `roleRequestService.ts` belong to tranche 05; tranche 02 must not import their
  new implementation before 05.

### 03 — Events and Home

Own:

- `src/features/events/**`, except explicit ownership exceptions
- `src/features/home/**`
- event pages and `src/components/event/**`
- `src/lib/eventCacheRefresh.ts`
- event CRUD, series, RSVP, attendance, duty, payment and Next Up tests

Explicit overlapping ownership:

- `src/components/event/PitchBoardActions.tsx`,
  `src/features/events/pitchBoardActionPolicy.ts`, and
  `src/components/pitch/hooks/usePitchBoardUnlinkEvent.ts` belong to tranche 07.
- `src/components/event/EventNotificationDialogs.tsx` belongs here; its
  dispatch-provider contracts are additionally gated by tranche 05 tests.
- `src/features/events/eventInviteResendWorkflow.ts` belongs here but must be
  tested with tranche 02 invite contracts.

### 04 — Competition

Own exactly the competition feature boundary and composition:

- `src/features/competitions/**`
- `src/components/CompetitionFixturesPanel.tsx`
- competition pages/routes and `src/lib/competitionScheduler.ts` where changed
- competition unit, role-isolation, mutation and journey tests

This tranche has no production migration or deployable Edge Function delta in
the current comparison.

### 05 — Messaging and notifications

Own:

- `src/features/messaging/**`
- `src/features/notifications/**`
- chat components, message/inbox/notification pages and chat orchestration hooks
- message cache, reconciliation, search, read-state, scheduling, reaction,
  notification routing and Realtime ownership helpers
- push subscription/reliability and notification navigation contracts

Explicit overlapping ownership:

- `src/features/media/useMediaRealtime.ts` belongs to tranche 06.
- `src/components/pitch/hooks/usePitchBoardFormationNotifications.ts` belongs
  to tranche 07.
- event notification UI remains in tranche 03.

### 06 — Vault and Media

Own:

- `src/features/vault/**`
- `src/features/media/**`
- Vault/Media pages and presentation components
- Vault upload/export/delete/Drive and Media access/storage/cache helpers
- `src/hooks/useChatVaultDeliverySync.ts`
- `src/lib/publishChatImageToGallery.ts`

The final two integration files depend on messaging contracts from tranche 05;
they must not be introduced earlier.

### 07 — PitchBoard, timer and AutoSub

Own:

- `src/components/pitch/**`
- AutoSub planner, timer, formation, active-game and resume boundaries
- PitchBoard event actions/policies explicitly excluded from tranche 03
- pitch notification-recipient and mini-league behavior tests
- `supabase/functions/check-pending-subs/index.ts`
- `supabase/functions/check-pending-subs/recipient-policy.ts`

The Edge Function extraction is behaviour-preserving by intent, but it is a
deployable production change and must remain coupled to its recipient-policy
tests.

### 08 — Telemetry and release closeout

Own:

- `supabase/migrations/20260724000000_harden_capacity_telemetry.sql`
- `capacitor.config.ts`
- `codemagic.yaml`
- production promotion workflow changes
- final cross-domain release documentation and native acceptance evidence

The telemetry migration is independent of the refactors and may instead be
promoted as its own reviewed backend tranche. It must never be silently bundled
with a UI tranche. It narrows `web_vitals` reads to app admins and adds a
service-role-only purge function; it creates no cron job.

## Backend compatibility matrix

| Artifact | Owner | Prerequisites | Compatibility window | Rollback |
| --- | --- | --- | --- | --- |
| Capacity telemetry migration | 08 | Existing telemetry tables, `has_role`, `app_role`, `service_role` | New app code does not depend on it; safe to deploy independently after policy review | Forward repair migration; do not delete migration history |
| `check-pending-subs` extraction | 07 | Existing subscriptions, roles, duties and event-group duties schemas | Source extraction must deploy atomically as one function directory | Redeploy prior function source after confirming schema compatibility |
| Event notification characterization/fake files | 00/03 tests | Test runner only | Not deployable | Revert test commit |
| Push queue internal-auth test | 00/05 tests | Test runner only | Not deployable | Revert test commit |

## Promotion-workflow boundary

The pull-request portion of `.github/workflows/promote-to-prod.yml` performs
file-only validation. The push-to-`prod` job is not a dry run: it contacts the
production Supabase project, applies migrations, deploys changed functions and
force-deploys notification bootstrap/probe functions. It is therefore owned by
tranche 08 and must be reviewed only after the application tranches are accepted.

## Construction gate for every tranche

Before creating a tranche branch, record:

1. exact `origin/main` base SHA;
2. exact cumulative source SHA;
3. `git diff --name-status` manifest for the selected files;
4. explicit list of imported changed files outside the selected set;
5. migrations and deployable Edge Function directories;
6. focused tests and full isolated baseline result;
7. rollback SHA and, for backend changes, forward-repair strategy.

Stop if any production file is unowned, assigned twice, imports a later-tranche
extraction, or changes an unrelated behavior. Do not solve an ownership conflict
by merging the whole cumulative branch.
