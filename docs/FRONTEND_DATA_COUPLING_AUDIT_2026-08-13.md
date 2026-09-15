# Frontend Data and Query Coupling Audit

**Status:** Analysis and prioritized remediation plan
**Reviewed:** 2026-08-13
**Scope:** Production TypeScript under `src`; no production behaviour changed

## Executive conclusion

The frontend is well protected by behavioural tests, but ownership of server
state remains distributed. The audit found 267 production files with direct
Supabase access and 320 files using TanStack Query/cache operations. Direct
access is concentrated in 120 component files, 73 pages, 37 hooks, and 36
general-purpose library files. Only one extracted `src/features` file directly
uses the singleton Supabase client; several other feature repositories correctly
receive data dependencies through adapters.

This is a maintainability risk, not proof of a current defect. RLS remains the
security boundary, and broad query-key prefixes can be intentional. The risk is
that data selection, tenant scope, optimistic updates, mutation sequencing, and
cache invalidation must be understood across many UI files before a safe change.

**Recommendation:** do not perform a repository-wide data-layer rewrite. Adopt
canonical feature adapters and query-key factories incrementally, beginning with
notifications and home-shell state. Preserve current behaviour with focused
characterization tests before moving each slice.

## Method and limitations

The audit counted non-test `.ts`/`.tsx` files containing direct calls through the
browser Supabase singleton (`from`, `rpc`, `functions`, `channel`, `storage`,
`auth`) and TanStack Query/cache operations. It then inspected large mixed
read/write modules, broad invalidation prefixes, current feature repositories,
and nearby test coverage.

Static counts do not establish vulnerability or runtime cost. A short query key
may still be safe because its fetcher includes current scope and RLS filters the
result. Conversely, dependency-injected repository calls are not included in the
singleton count. Each candidate needs behavioural verification before change.

## Current positive foundations

- Extracted repositories/workflows exist for competitions, events, membership,
  messaging, and vault.
- Competition fixtures already demonstrate a canonical key factory in
  `src/features/competitions/fixtures/queryKeys.ts`.
- Messaging has scoped read-model and realtime reconciliation boundaries.
- Events and vault have extracted mutation/read services even though page-level
  cache coordination remains extensive.
- The complete baseline covers frontend, Playwright, and isolated Supabase
  behaviour, providing a strong safety net for incremental moves.

## Ranked coupling hotspots

| Rank | Area | Evidence and principal risk | Canonical target | Tests required before movement |
| --- | --- | --- | --- | --- |
| 1 | Notifications and unread state | `NotificationsPage` (1,224 lines, 16 direct calls, 32 cache operations), `AppHeader` (1,396/14/16), `useAuth`, and chat-read helpers share broad prefixes such as `notifications`, `recent-notifications`, `unread-count`, and `club-unread-count`. Club switching, optimistic clearing, realtime and push navigation can disagree. | `src/features/notifications`: scoped key factory, repository, unread projection, mutation completion and realtime adapter | Active-club versus cross-club counts; mark-one/visible/all; optimistic rollback; push/in-app navigation; realtime arrival; logout/account switch cache purge; resume/reconnect |
| 2 | Home-page read composition | `HomePage` is 2,978 lines with 16 direct calls and 30 cache operations, including one unscoped `invalidateQueries()` recovery callback. Many cards combine club, event, RSVP, messages, rewards and invites. | `src/features/home`: read-model composition and card-specific adapters; recovery invalidation policy | Active club switch; next-up ordering; no layout jolt; recovery invalidates only required domains; stale/partial failure; resume/offline recovery |
| 3 | Event cards and detail orchestration | `EventCard` has 22 direct calls; `EventDetailPage` is 3,552 lines with 11 direct calls and 48 cache operations. Extracted event workflows exist but page/card still coordinate supporting reads and cache families. | Extend `src/features/events` with an event key factory and UI-facing controllers | Create/edit/delete/cancel; series edits; RSVP/guardian; club-wide grouping; attendance; chat autopost; optimistic failure and exact cache refresh |
| 4 | Invite acceptance and membership onboarding | `JoinTeamPage` has 15 direct calls; `PendingInviteWelcomeDialog` has 12. Club/team/role/guardian assignment and cold-start auth are multi-step and identity-sensitive. | Extend `src/features/membership` with invite read model, acceptance coordinator, and canonical membership keys | Every role invite; cold/warm start; existing/new user; duplicate child prevention; guardian preservation; active-club selection; partial backend failure/idempotent retry |
| 5 | Team and user administration | `ManageUsersPage` (2,010 lines, 13 direct calls), `TeamDetailPage` (2,978 lines, 8 direct calls, 52 cache operations), role dialogs and member sheets distribute membership writes and invalidation. | `src/features/membership/admin` and `src/features/teams`: scoped repositories, mutation service, key factories | Permission matrix; cross-club denial; add/update/remove; archived teams excluded; same-name recreated team has new identity/chat; rollback on multi-write failure |
| 6 | Vault page cache orchestration | `VaultPage` is 4,019 lines with 65 cache operations. Repository/service extraction is strong, but the page still coordinates `vault-files`, `vault-trash`, `storage-breakdown`, and `photos` prefixes repeatedly. | Add `vaultKeys` and a mutation-completion/cache policy under `src/features/vault` | Delete feed-only versus feed+vault; trash/restore/permanent delete; move/upload/import; quota; cross-club access; optimistic rollback; selector refresh |
| 7 | Media upload and gallery coordination | `UploadPhotoSheet` has 10 direct calls and invalidates photo, vault and storage domains. Media, chat-shared media, albums and vault have distinct permission/lifecycle rules. | `src/features/media`: upload workflow, audience policy, media key factory and completion adapter | Gallery versus shared-chat pagination; role/team targeting; archived teams excluded; upload partial failure; signed/private access; notification recipients |
| 8 | Authentication/session lifecycle | `useAuth` has 13 direct calls and also coordinates resume, realtime, notification invalidation, club context and account recovery. A change can freeze multiple pages or leak previous-user cache. | `src/features/auth`: session lifecycle state machine, resume policy, account-switch cleanup; retain provider as composition | Cold start/deep link; background resume online/offline; token refresh; logout/login as another user; bounded refetch; legal reacceptance; passkeys |
| 9 | Competition detail and settings | `CompetitionDetailPage` has 10 direct calls and 19 cache operations. Fixture and ladder repositories are extracted, but higher-level competition administration remains page-coupled. | Extend `src/features/competitions` with competition keys, settings/admin repository and controller | Role permissions; divisions/teams; generation/manual fixtures/finals; score/ladder; invite acceptance; deletion/cancellation; cache refresh |
| 10 | Subscription and entitlement flows | Upgrade, club/team subscription, fees, Stripe settings and IAP modules use separate reads/keys. Exact-club entitlement is security and revenue critical. | `src/features/entitlements`: exact-scope read model and key factory; payment-provider adapters remain separate | Free/Pro exact-club isolation; expiry/grace/refund; web Stripe and native IAP; restore purchase; failure/cancel; cache update after webhook/poll |
| 11 | Season rollover/team recreation | Season pages and wizard steps combine archive, draft teams, membership mapping, invitations and chat/event side effects. | `src/features/seasons`: rollover plan, repository and resumable workflow | Archive/current filtering; mapping old users; new invitations; same-name team identity; resumable partial failure; duplicate prevention |
| 12 | Mini-league administration | Multiple dialogs directly read/write players, guardians, admins, settings and games. | `src/features/miniLeagues`: scoped repository, admin policy and mutation workflows | Admin permissions; guardian/child assignment; fill-in players; game-day/pitch-board state; cross-league isolation |
| 13 | Messaging ancillary mutations | Core inbox/thread models are extracted, but participants, polls, reactions, uploads, group creation and scheduled messages still span chat components/hooks. | Extend `src/features/messaging` with mutation repositories and one thread key family | Every chat type; reaction optimistic/rollback; participant permissions; upload/poll/reply; wrong-thread prevention; settled reveal/realtime dedupe |
| 14 | EOI/enrolment administration | EOI hooks share broad `eoi-submissions` invalidation while admin, team builder, enrolment and attendance combine reads and writes. | `src/features/eoi`: scoped keys and workflow repository | Club isolation; role permissions; enrolment capacity; team assignment; mutation failure; correct list/stat refresh |
| 15 | Analytics and secondary administration | Engagement, ads, rewards, sponsors, backups and settings contain sizeable direct query surfaces but lower-frequency user paths. | Domain-specific repositories only when next changed | Permission denial, tenant isolation, empty/large datasets, external-function failure and export correctness |

## Target design rules

1. Each domain owns a typed query-key factory. Keys include user, club, team,
   thread, event, competition, filters, and pagination whenever those values can
   change the result.
2. Components render and collect intent; repositories perform data access;
   workflows coordinate business operations; mutation-completion policies own
   cache changes.
3. Do not create a universal `api.ts` or generic repository. That would hide
   domain rules while increasing coupling.
4. Prefer backend RPC/database atomicity for one business operation spanning
   multiple writes. Frontend compensation is a deliberate fallback, not the
   default.
5. Cache invalidation uses exact domain factories or documented prefixes. A
   global `invalidateQueries()` requires explicit justification and a lifecycle
   regression test.
6. Repositories return typed domain results and normalize Supabase errors at the
   boundary. UI modules should not reinterpret raw PostgREST response shapes.
7. UI permission checks improve UX; RLS/Edge authorization remains mandatory.
8. Preserve stable loading/reveal behaviour while moving data ownership. Faster
   refetch is not an improvement if content jolts or reveals the wrong scope.

## Characterization-test gate for every slice

Before extraction, demonstrate:

- successful read/write behaviour;
- exact user/club/team/thread scope and scope switching;
- backend permission denial;
- validation failure;
- empty, stale, paginated, and partial data;
- optimistic success and rollback;
- cache refresh without unrelated/global refetch;
- resume/reconnect and realtime reconciliation where applicable;
- duplicate-submit/idempotent retry for multi-operation workflows.

Tests should assert externally visible behaviour and repository contracts, not
the component's internal hook arrangement.

## Recommended delivery sequence

### Slice A — notification cache contract

Analysis/tests first. Introduce a key factory and characterize every existing
producer/consumer. Move no UI and change no fetch semantics initially. This is
the highest-value slice because notification/unread state crosses the app shell,
auth lifecycle, messaging, realtime and deep links.

**Checkpoint 2026-08-13:** the canonical key factory and migration
characterization guards now exist under `src/features/notifications`. They are
wired into `NotificationsPage`, `AppHeader`, auth realtime invalidation,
`MessagesPage`, and the chat-scope read helper while preserving the previous
resolved key arrays and prefix semantics. Focused notification, unread, routing,
realtime and recovery verification passed 126/126 after migration and rollback
hardening. The audit found and corrected one existing cache-consistency defect:
failed mark-one, mark-visible, delete-one, or clear-visible writes could leave
the page cache in its optimistic state until a later refetch. Those operations
now snapshot only the current user's notification-list family, restore all
affected club views on failure, leave other accounts untouched, and reconcile
the unread count. The next reviewable step is consolidation of repeated
notification mutation-completion policy without changing backend calls or UX.

**Slice A completion:** repeated user-list selection, cancellation,
snapshot/update, rollback, and notification-surface invalidation now live in the
notification feature boundary. `NotificationsPage` and the header preserve
their prior mutation ordering, invalidation breadth, backend calls, filters,
timers, and visible UX. Focused verification passes 128/128. Further notification
extraction should be demand-led; the next planned coupling slice is the home
read model and bounded recovery invalidation.

### Slice B — home read model and bounded recovery

Separate card reads and replace the global recovery invalidation with a tested
domain list only after proving which cards must refresh.

**Bounded-recovery checkpoint 2026-08-13:** the `recover-account` function only
clears `profiles.scheduled_deletion_at`; the banner clears its own local state,
and no Home card reads this field. The only query-backed frontend consumer is
app-admin user search. The previous whole-cache `invalidateQueries()` has been
replaced by a tested `search-users-manage` family invalidation. This prevents a
successful recovery from refetching unrelated events, membership, messages,
notifications, vault, and home-card data. Focused Home/recovery verification
passes 64/64. The next Slice B step is to characterize the primary Home read
composition before extracting any repository/controller boundary.

**Primary-read checkpoint 2026-08-13:** the consolidated membership/event read
now lives in `src/features/home/homeMembershipEventsRepository.ts`, while
`HomePage` retains React Query ownership and its existing freshness, retry,
placeholder, and enablement policy. The move preserved the existing Supabase
request shapes, per-club/per-team candidate windows, batching, result merging,
soft-delete filtering, partial-data handling, and error behaviour. A boundary
contract prevents the primary `user_roles` and `events` reads drifting back into
the page. The complete focused Home suite passes 72/72 and TypeScript validation
passes. Continue Slice B only with small card-specific boundaries when they are
next changed; do not turn this into a wholesale Home rewrite.

**RSVP-status checkpoint 2026-08-13:** Home's compact RSVP-status read now uses
`src/features/home/homeRsvpRepository.ts`. Direct repository tests protect the
empty-event fast path, exact current-user and visible-event scope, deliberate
exclusion of child RSVP rows, null-result handling, and propagation of backend
or permission failures. A page-boundary guard preserves the existing scoped
query key, enablement, stale time, and placeholder-data policy. The expanded
focused Home suite passes 78/78 and TypeScript validation passes.

**Entitlement/reward-club checkpoint 2026-08-13:** Home's aggregate Pro-access
and reward-club subscription reads now use
`src/features/home/homeEntitlementRepository.ts`. Contracts cover all four
club/team entitlement flags, the legacy `teams.is_pro` website-trial fallback,
no-membership behaviour, fail-closed missing/error payloads, exact membership
club matching, and active-club reward scoping. Page guards preserve the existing
identity/scope-bearing query keys, enablement, stale-time, and placeholder-data
policies. The expanded Home plus shared Pro-access verification passes 108/108;
TypeScript and diff validation pass.

**Rewards/children checkpoint and Slice B stop 2026-08-13:** pending redemption,
available reward, next-threshold, and guardian-aware child reads now use
`src/features/home/homeRewardsRepository.ts`. Contracts preserve current-user
and exact-club filters, active/non-player-of-match eligibility, lowest-threshold
ordering, app-admin eligibility, latest-pending selection, owned/guardian child
de-duplication, alphabetical ordering, and the existing best-effort partial-data
semantics. Page guards protect every existing query key and freshness policy.
The focused Home/entitlement set passes 119/119; TypeScript and diff validation
pass. Slice B should stop here: remaining Home reads are lower-value or belong
to pitch-board/invite/reward-mutation domains and should move only with work in
those owning features.

### Slice C — event key family and card/detail controllers

Build on the existing event repositories/workflows. Consolidate cache completion
without rewriting event UX.

**Key-family checkpoint 2026-08-13:** canonical event cache identities now live
in `src/features/events/eventQueryKeys.ts`. Create/edit completion, RSVP
completion, list/Home refresh, and the core Event Detail read/cancellation paths
use this factory while resolving to the same arrays as before. Contracts cover
list prefixes, exact event-derived keys, Home user scope, and PitchBoard's exact
and intentionally broad team-member keys. The full event feature plus Event
Detail characterization set passes 309/309; TypeScript and diff validation pass.
The next Slice C step should consolidate one repeated mutation-completion family
(duties or payments), rather than migrate every secondary read at once.

**Duty-completion checkpoint 2026-08-13:** all seven Event Detail duty mutation
outcomes now reconcile through `refreshEventDuties`, including successful add,
claim, complete, undo, delete and assign operations plus the partial-commit case
where completion succeeds but administrator notification fails. The policy
invalidates only the exact event duty key; mutation order, toasts, dialog state,
and backend writes are unchanged. The full event feature and Event Detail set
passes 311/311; TypeScript and diff validation pass. Payments are the next
contained completion family if Slice C continues.

**Payment-completion checkpoint 2026-08-13:** the three legitimate Event Detail
payment refresh paths now use `refreshEventPayments`: confirmed checkout status,
successful browser-return status, and a committed administrator ledger toggle.
The policy invalidates only the exact event payment key. Failed server-side
confirmation, cancelled checkout, failed checkout and denied ledger mutations
remain non-success paths and do not falsely reconcile as committed payments.
The full event feature and Event Detail set passes 313/313; TypeScript and diff
validation pass. Slice C should next assess Event Detail supporting reads before
choosing any further extraction; the high-value repeated completion families
are now consolidated.

**Access-boundary checkpoint and Slice C close 2026-08-13:** Event Detail's
app-admin, event-manager, general Pro and Pro Football resolution now use
`src/features/events/eventAccessRepository.ts`. Tests preserve the club-first,
team-second and mini-league-third manager hierarchy, exact scope filters,
short-circuiting, every subscription/admin-override flag, team-first entitlement
lookup, club fallback, and fail-closed missing-data behaviour. Backend RLS/RPC
checks remain authoritative. The full Event feature and Event Detail set passes
320/320; TypeScript and diff validation pass. Slice C is complete. Remaining
large reads are PitchBoard roster/session or mini-league concerns and should be
changed only in those owning feature tranches rather than further enlarging the
generic Event boundary.

### Slice D — membership invite and team-admin state

Unify invite/member keys and acceptance orchestration around the existing
membership services, preserving cold-start and guardian behaviours.

**Invite read/key checkpoint 2026-08-13:** canonical invite identities now live
in `src/features/membership/membershipQueryKeys.ts`, covering cold/warm token
reads, destination roles, join profile, child linking, per-user pending lists,
and intentional post-accept prefixes. The pending-invite list read and its
completion refresh now live in `pendingInviteRepository.ts`, preserving exact
signed-in-user and pending-status filters, the ten-row processing bound, and the
existing safe-empty background fallback. No acceptance writes moved in this
slice. Membership, guardian, invite handoff, cold-start, filtering and boundary
verification passes 259/259; TypeScript and diff validation pass. The next Slice
D step is to characterize acceptance outcome/cache completion before moving any
multi-step write orchestration.

**Token-resolution checkpoint 2026-08-13:** pending and reusable team invite
token resolution now lives in `inviteTokenRepository.ts`. Contracts pin the two
secure RPC names and token arguments, distinguish a valid unknown token from a
backend failure, and preserve the normalized team, club, expiry, usage and child
metadata consumed by the join UI. Review of acceptance completion confirmed the
guardian path is already transactional and idempotent, while the legacy direct
join path has broader multi-step writes and different child-step outcomes. Those
writes were deliberately left in place pending explicit success/partial-failure
characterization; no cache refresh or UX behaviour was added implicitly. The
expanded membership/invite set passes 263/263; TypeScript and diff validation
pass.

**Direct-join policy checkpoint 2026-08-13:** reusable-link expiry and usage
validation, exact-destination duplicate-role suppression, and post-commit child
step selection now live in `inviteAcceptancePolicy.ts`. Tests pin the existing
error text and every current completion outcome. They also make explicit a
legacy distinction: after photo-consent continuation, a mini-league reusable
parent link currently completes without opening the child-add step, whereas the
normal completion path opens it. This slice preserves that behaviour rather
than silently treating it as a refactor fix. Multi-step role/child/invite writes
remain in `JoinTeamPage` until atomicity or partial-failure expectations are
agreed. The membership/invite set passes 268/268; TypeScript and diff validation
pass.

**Team-administration completion checkpoint 2026-08-13:** role changes, full
member removal, child assignment removal and self-leave now have distinct cache
completion policies in `teamMembershipCacheCompletion.ts`. Full removal retains
the exact team roster, team-chat membership and authorization refreshes; child
removal refreshes only the exact child roster; self-leave retains all eight
existing membership, filter, event and RSVP refresh families. The atomic
`remove_team_member` RPC, guardian preservation, future-RSVP cleanup,
notifications, navigation and error UX are unchanged. Membership/invite and
Team Detail characterization passes 308/308; TypeScript and diff validation
pass. The next safe Slice D work is adoption of the canonical team-role key and
completion policy by the smaller role-management components.

**Team-role adoption checkpoint 2026-08-13:** role management, captain control,
single/bulk member addition, promotion, child-parent linking and player addition
now use the canonical exact-team role completion policy. `ManageTeamRolesPage`
also uses the canonical read key. Cross-team moves deliberately retain broad
role and child prefixes because both source and destination rosters change. The
optional club-level invite-reconciliation key remains untouched because its
historical `undefined` segment does not have the same matching semantics as the
broad prefix. The expanded membership and role-management set passes 343/343;
TypeScript and diff validation pass. Remaining Slice D work is limited to
chat-participant role effects and deciding whether direct invite acceptance
should move to an atomic backend contract; avoid further general key migration.

**Chat-participant checkpoint and safe Slice D close 2026-08-13:** team-scoped
role and member removals initiated from the chat participant sheet now use one
exact team-roster/chat-members completion policy, while non-team chat membership
retains its chat-only refresh. The audit confirmed an existing architectural
inconsistency: Team Detail full-member removal uses the atomic
`remove_team_member` RPC (including child assignment and group cleanup), whereas
chat currently deletes matching `user_roles` directly. That production behaviour
was preserved and should be addressed as an explicit backend/workflow fix, not
hidden in this cache refactor. The expanded membership, role and chat-surface set
passes 358/358; TypeScript and diff validation pass. Safe Slice D refactoring is
complete; atomic direct-invite and chat-member removal are documented follow-up
decisions.

### Slice E — vault/media cache contracts

Use the existing vault repositories as the data boundary; reduce page-level
invalidation and then establish the separate media domain.

Stop after each slice for focused tests, the complete baseline, and manual UI or
native verification appropriate to the changed lifecycle. Promote slices
separately according to `docs/PROMOTION.md`.

## Success measures

Measure direction rather than chase arbitrary counts:

- sensitive domains have one documented query-key family;
- new direct Supabase calls are added inside the owning repository/workflow;
- page/component data calls decline in each touched domain;
- global invalidation disappears unless explicitly justified;
- multi-operation business writes have an atomic backend contract or tested
  compensation/idempotency;
- focused and complete baselines remain green;
- vendor engineers can locate the owner of a read, mutation, and cache effect
  from the feature directory without tracing several pages.

## Explicit non-goals

- No hosted database inspection or testing.
- No wholesale Supabase client wrapper.
- No global query-key rename in one change.
- No behaviour or UX redesign hidden inside extraction.
- No deletion of existing tests or migration history.
