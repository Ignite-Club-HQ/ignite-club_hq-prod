# Ignite Club HQ — Events refactoring plan

**Established:** 11 August 2026
**Development branch:** `codespaces-review`
**Starting checkpoint:** `74d6ec4d4`
**Status:** E0–E7 complete on the cumulative integration branch; automated closeout passed; delegated manual acceptance and promotion pending. See `REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md`.

## E1 progress — 11 August 2026

The first production refactoring slice centralizes frontend event capabilities:

- `canManageEvent` now represents the existing scoped event-manager or
  app-admin decision consistently across sensitive reads and page controls;
- `canOperateMatch` preserves the narrower exact-event Subs Manager grant for
  PitchBoard and score operations without granting full event administration;
- unresolved role queries continue to fail closed;
- backend RLS and RPC authorization remain authoritative and unchanged.
- club, team and mini-league manager role sets now live in one directly tested
  policy instead of being repeated inside the Event Detail query;
- the existing scope precedence remains unchanged: club management is checked
  first, then the matching team or mini-league scope.

Verification: 6 direct capability-policy tests, 15 manager-role policy tests,
45 Event Detail behavior tests, 9 recipient-policy tests and TypeScript all
pass.

## E2 progress — 11 August 2026

The first read-repository slice extracts the core Event Detail fetch:

- the exact event/team/club projection and single-event filter now live behind
  `fetchEventDetail`;
- a successful missing/RLS-hidden row remains `null`;
- permission, transport and database errors continue to propagate so React
  Query can retry and the page cannot misrepresent them as “event not found”;
- existing retry, watchdog, cache and rendering behavior remains page-owned.

Verification: 4 repository tests plus the 75 E1/Event Detail tests and
TypeScript pass (79 focused tests total).

The second read-repository slice extracts the Event Detail RSVP read and its
display enrichment:

- RSVP rows are always filtered by the exact event id and database failures
  still propagate into the page's attendance-unavailable state;
- profile/avatar and child-name lookups remain display-only, best-effort
  enrichment and cannot erase valid attendance rows;
- adult, guardian and child ownership fields are returned unchanged;
- the page retains attendance retry, cached-background-error and action-disable
  behavior.

Verification: 4 RSVP repository tests plus the existing focused estate and
TypeScript pass (83 focused tests total).

The third read-repository slice extracts event guests and duties:

- both authoritative reads remain filtered to the exact event id and propagate
  database/permission failures;
- guest adder names remain best-effort display enrichment with the existing
  neutral fallback;
- duplicate guest adders are resolved through one profile lookup;
- duty assignee display context and page refetch settings remain unchanged.

Verification: 5 supporting-read tests plus the existing focused estate and
TypeScript pass (88 focused tests total).

The fourth read-repository slice extracts payment and match-award markers:

- paid-user markers remain filtered by event and queried only for event
  managers by the page;
- captain, Player of the Match and goalkeeper reads retain their exact event
  filters and adult/child identity columns;
- missing single markers remain `null`, while read failures propagate rather
  than being interpreted as unpaid or unawarded state;
- checkout, ledger mutations, selectors and Pro gating are unchanged.

Verification: 7 payment/award repository tests plus the existing focused
estate and TypeScript pass (95 focused tests total).

The fifth read-repository slice extracts the targeted attendance boundary:

- the SECURITY DEFINER roster RPC remains called with only the exact event id
  and failures propagate into the existing grouped-attendance error state;
- adult rows can no longer enter child composition;
- RLS-visible and scoped child rows are merged immutably and deduplicated,
  preserving visible names and filling only missing data;
- reminder candidates remain limited to targeted-team adults and linked
  parents/guardians, excluding unrelated teams and unlinked club officials;
- personal child lookup, grouping presentation and backend authorization are
  unchanged.

Verification: 8 targeted-attendance tests plus the existing focused estate and
TypeScript pass (103 focused tests total).

The sixth read-policy slice extracts schedule visibility and retention:

- team, club-wide and mini-league visibility rules now live in one pure policy;
- ordinary club membership still cannot expose unrelated team events;
- club-admin team visibility remains available only when explicitly filtering
  that team, preserving the existing behavior;
- team versus `ml:` filter parsing and 48-hour cancelled-event retention are
  directly tested;
- query windows, cache keys, offline fallback and recurring-series display are
  unchanged.

Verification: 7 schedule-policy tests plus the existing focused estate and
TypeScript pass (110 focused tests total).

Existing defect noted but deliberately not changed in this refactoring slice:
the Events query exits early when both team and club scopes are empty without
checking a non-empty mini-league scope. A mini-league-only parent/admin may
therefore see an empty schedule. This requires a separate behavior fix and
regression test before altering production behavior.

The seventh read-policy slice extracts direct schedule membership derivation:

- team and club ids, club-admin team-filter scope, league-admin club scope and
  the app-admin marker now derive from one pure role policy;
- club admins intentionally remain excluded from automatic all-league access;
- guardian/parent/team and mini-league id paths use one null-safe deduplicator;
- the Supabase membership waterfall, diagnostics, retry behavior and the known
  mini-league-only early exit remain unchanged.

Verification: 6 membership-policy tests plus the existing focused estate and
TypeScript pass (116 focused tests total).

The eighth slice completes E2 schedule read orchestration:

- list/calendar date windows, aborted-request classification, cache fallback
  and successful-row finalization now live in directly tested policies;
- aborted stale requests still return cached rows or a non-error empty result;
- database/permission failures use cache when present and otherwise propagate;
- visibility, cancellation retention and recurring-series limiting are applied
  in one ordered finalization boundary before the user-scoped cache is written;
- PostgREST query construction, React Query settings, diagnostics, cache keys
  and cold-offline rendering remain page-owned and unchanged.

Verification: 10 schedule-query policy tests plus the existing focused estate
and TypeScript pass (126 focused tests total). E2 is now complete, with the
mini-league-only early-exit defect still intentionally outstanding as a
separate behavior fix.

## E3 progress — 12 August 2026

The first create/edit workflow slice extracts shared form normalization:

- create and edit now share one pure mapping for title/location text, team and
  club identity, bye/opponent/arrival fields, social price/guest settings,
  role restriction, adults-only state, RSVP grouping and multi-team targets;
- mini-league create normalization remains explicit at the create boundary;
- reminder reset, recurrence, timestamps, creator identity, duties and the
  create/edit RPC transaction shapes remain owned by their respective pages;
- obsolete source-inspection assertions were replaced by direct behavioral
  payload-policy tests and lightweight wiring contracts.

Verification: 7 direct payload-policy tests, 9 remaining transaction/source
contracts, create/edit validation suites, selected E2 policies, Event Detail
characterization and TypeScript pass (94 focused tests in this gate).

The second E3 slice extracts recurrence and timestamp policy:

- daily, weekly/selected-weekday, biweekly and monthly occurrence generation
  is shared by create and edit;
- create child timestamps remain aligned to the parent's local hour/minute and
  return `null` when no child occurrence exists;
- bare start/end times are placed on the selected event date;
- edit continues to preserve a valid original duration when moving an event,
  retains an end-only legacy timestamp, and does not invent an end from invalid
  source timestamps;
- create/edit transaction choice and RPC shapes remain unchanged.

Verification: 9 direct recurrence/timestamp tests plus the payload,
validation, schedule and Event Detail gates and TypeScript pass (90 focused
tests in this slice gate).

The third E3 slice extracts the atomic create transaction:

- the page now delegates the event, recurring child dates and game-duty payload
  to one feature-local workflow;
- the existing `create_event_with_duties` RPC name and argument shape are
  preserved exactly, including the normalized ISO event date;
- RPC errors and a successful response without an event id fail explicitly;
- no fallback table writes are attempted, protecting the existing all-or-
  nothing event/duty guarantee;
- conflict checks, double-submit state, cache refresh, toast copy and navigation
  remain page-owned and behaviorally unchanged.

Verification: 5 direct create-transaction tests plus recurrence, payload,
create/edit validation and page-wiring contracts pass (40 focused tests), and
TypeScript passes.

The fourth E3 slice extracts occurrence/series updates and duty synchronization:

- one directly tested boundary now chooses between an exact-event table update
  and the existing transactional `update_event_series` RPC;
- selected event, start and end timestamps retain their existing alignment and
  exact database argument shapes;
- duty additions, edits and removals retain their single `sync_event_duties`
  transaction, including stable indexes used to return generated ids;
- permission and database errors continue to propagate to the page, where the
  existing partial-success duty message remains unchanged;
- conversion of a single event into a recurring series remains page-owned and
  deliberately untouched pending its own high-risk slice.

Verification: 8 direct edit/duty workflow tests plus create transaction,
recurrence, payload, validation and page-wiring contracts pass (48 focused
tests), TypeScript passes and `git diff --check` is clean.

The fifth E3 slice extracts conversion of a single event into a recurring
series:

- parent conversion, child construction and child insertion now live behind a
  directly tested workflow boundary;
- child start times remain aligned to the selected local time, valid duration
  is preserved, and absent end times remain absent;
- child rows retain the original event's club, team and mini-league scope plus
  the current creator and parent id;
- single-occurrence conversions do not attempt an empty child insert;
- controller-owned payloads and dates are not mutated.

Verification: 15 direct edit workflow tests (including 7 conversion cases)
plus create transaction, recurrence, payload, validation and page-wiring
contracts pass (55 focused tests), TypeScript passes and `git diff --check` is
clean.

The pre-existing partial-commit defect was subsequently fixed through a
forward-only backend migration: parent conversion and child insertion now run
inside `convert_event_to_recurring_series`, so invalid or failed child writes
roll back the complete conversion. A follow-up security migration removes
client-controlled club/team scope from the SECURITY DEFINER update allowlist;
children inherit authoritative scope from the locked parent and ownership from
the authenticated caller. The frontend delegates to this RPC through the
feature workflow without changing recurrence generation or user-facing flow.

Post-fix verification: 11 migration security contracts, 6 page/workflow wiring
contracts, 15 edit workflow tests and the broader create/edit gate all pass
(72 focused tests total), along with TypeScript and `git diff --check`.

The sixth E3 slice extracts training-conflict matching and override policy:

- conflict checking remains limited to training submissions that have not been
  explicitly confirmed by the user;
- direct-date matches retain exact club, active-state, venue, hour and minute
  semantics;
- eligible recurring parents retain venue/time/weekday matching and are not
  counted twice when also returned by the direct query;
- venue normalization, cross-team club-wide collisions, missing display team
  names and empty result sets are directly tested;
- Supabase query construction and confirmation-dialog presentation remain
  page-owned.

Verification: 8 direct conflict-policy tests plus create transaction, payload,
recurrence, validation and page-wiring contracts pass (42 focused tests),
TypeScript passes and `git diff --check` is clean.

The pre-existing conflict-read reliability gap was subsequently fixed on
`main` and merged back into this tranche. Both query errors now return an
explicit fail-closed state, suppress the genuine-conflict dialog, show a
non-technical retry message and prevent the create transaction from running.
Successful null/empty reads remain clear, while genuine conflicts retain the
existing confirmation override.

Post-fix verification: 16 direct conflict and page-wiring tests plus create
transaction, payload, recurrence, validation and characterization contracts
pass (50 focused tests), along with TypeScript and `git diff --check`.

The seventh E3 slice hardens repeated-submit and conflict-confirmation
orchestration:

- a synchronous ref-backed gate now reserves submission before the first
  awaited validation, closing the same-render window left by React state;
- rapid initial taps and rapid conflict-confirmation taps cannot run parallel
  validation/create transactions;
- stale-team, scope, location, mini-league, recurrence, arrival-time and
  conflict-check exits release the reservation for a normal retry;
- genuine conflict confirmation releases before presenting the dialog, then
  retries through the same guarded path while bypassing only the already-
  confirmed conflict lookup;
- mutation success and failure both release in `finally`, while the existing
  visible `saving` state and disabled button remain unchanged.

Verification: 8 submission-gate and page-wiring tests plus conflict policy,
atomic create, validation and characterization contracts pass (42 focused
tests), TypeScript passes and `git diff --check` is clean.

The eighth E3 slice extracts successful mutation completion:

- create completion preserves its membership, Schedule, Next Up and team-event
  invalidations plus persisted-cache clearing before navigating to the new
  event;
- cache refresh remains best-effort after a committed create, so an
  invalidation failure is logged but never misreported as event-creation
  failure or allowed to strand the user on the form;
- edit completion preserves exact-event and PitchBoard invalidations plus the
  shared event-derived cache refresh before returning to Event Detail;
- page-order contracts prove create completion runs only after the atomic RPC,
  and edit completion only after the event and duty workflows both succeed;
- neither mutation error path invalidates caches or navigates.

Verification: 6 completion behavior/order tests plus submission, create/edit
workflow, payload, validation and characterization gates pass (53 focused
tests), TypeScript passes and `git diff --check` is clean.

## E4 progress — 12 August 2026

The first RSVP/attendance slice extracts personal and guardian-owned child RSVP
persistence:

- personal offline submissions retain the existing durable queue contract and
  perform no Supabase write;
- personal online updates remain id-scoped, while inserts retain authenticated
  ownership, notes and explicit `source: "user"` attribution;
- guardian child updates target the canonical RSVP id without replacing the
  original guardian ownership;
- new child rows retain acting-guardian ownership and explicit user source;
- when the duplicate-child trigger redirects a co-guardian insert, the workflow
  resolves the canonical event/child row and preserves the existing shared-
  guardian semantics;
- write and canonical-lookup failures propagate; early-RSVP points, payment
  prompts, notifications and cache invalidation remain page-owned.

Verification: 8 direct RSVP workflow tests, 4 RSVP read-repository tests and 45
Event Detail behavior tests pass (57 focused tests), TypeScript passes and
`git diff --check` is clean.

The second E4 slice separates mini-league self-service from administrator RSVP
operations:

- parent self-service inserts remain owned by the parent and exact mini-league
  player, with explicit user source; existing rows update only by canonical id;
- adult-member, child-linked mini-league and standalone mini-league admin upserts
  retain their distinct exact `admin_upsert_rsvp` argument shapes;
- existing RSVP status changes remain routed through
  `admin_update_rsvp_status` with the acting administrator identity;
- the existing team-event admin-child lookup/update-or-insert path is isolated
  without changing its ownership or persistence behavior;
- privileged RPC and direct-write failures continue to propagate, while cache
  invalidation and user messaging remain page-owned.

Verification: 15 direct RSVP workflow tests, 7 attendance-failure contracts, 4
RSVP read tests and 45 Event Detail behavior tests pass (71 focused tests),
TypeScript passes and `git diff --check` is clean.

Known pre-existing reliability gap, deliberately unchanged: the team-event
admin-child path discards errors from its canonical RSVP lookup. If that read
fails it may proceed to an insert with unknown existing state, risking a
duplicate attempt or misleading error. This should be fixed separately with a
fail-closed lookup or, preferably, the already-authorized admin upsert RPC.

The third E4 slice extracts RSVP completion and cache policy:

- all successful RSVP paths refresh exact attendance and going-roster caches;
- self/guardian child completion retains event-group and PitchBoard refreshes
  plus the 1.5-second points-history/rank refresh used by fire-and-forget awards;
- parent mini-league completion retains event-group refresh without adding
  unrelated PitchBoard or points work;
- mini-league administrator completion retains groups and PitchBoard, while
  ordinary admin member/child completion retains its narrower PitchBoard scope;
- post-RSVP push nudges and paid-social checkout timing remain page-owned and
  unchanged.

Verification: 4 direct completion-policy tests, 15 RSVP workflow tests, 7
attendance-failure contracts and 45 Event Detail behavior tests pass (71
focused tests), TypeScript passes and `git diff --check` is clean.

The fourth E4 slice extracts targeted attendance bucketing:

- child identity takes precedence over guardian identity, including linked
  mini-league players, so responses land in the child's grade/team;
- adult identity is used only for genuine adult responses;
- configured grade/team order and source row order remain stable;
- attendees and non-responders resolving outside a targeted audience are
  excluded rather than leaking into a visible bucket;
- legitimate club-level adults remain in the existing Other bucket;
- child and adult non-responders compose into the same ordered groups without
  losing identity or duplicating multi-role adults;
- the existing group-map hook continues to own team/level resolution, scoped
  roster reads, missing labels and query error/retry state.

Verification: 8 direct attendance-bucketing tests, 7 group-map tests, 8
targeted-roster tests and 45 Event Detail behavior tests pass (68 focused
tests), TypeScript passes and `git diff --check` is clean.

The fifth and final E4 slice extracts attendance audience and non-responder
identity policy:

- default attendance views retain players/children-only behavior, while the
  all-roles toggle restores adult rows and mini-league parent rows;
- direct child and linked mini-league child RSVPs share one identity key, so
  duplicate representations of the same child render once;
- targeted events exclude uninvited child/adult rows and hydrate authorized
  scoped child names;
- a parent's personal RSVP never counts as the child's response;
- mini-league players count as responded only through their exact player id or
  linked child id;
- a child response removes every linked parent and guardian from the adult
  no-response/reminder lists, without removing unrelated household players;
- visible roster filtering remains independent of the broader authorized
  reminder audience;
- adults-only child suppression remains upstream and unchanged.

Verification: the complete E4 gate passes 109 focused tests across audience,
grouping, RSVP workflows/completion, group-map, targeted roster, attendance
failure, core audience helpers and Event Detail behavior. TypeScript passes and
`git diff --check` is clean.

E4 is closed. Do not extract additional RSVP callbacks unless a future defect
or feature demonstrates a missing boundary. The admin-child lookup error gap
remains separate defect work and is not a reason to extend this refactor.

## E5 progress — 12 August 2026

The first lifecycle-side-effect slice extracts the authoritative cancellation
writes from Event Detail:

- single-event cancellation remains an exact-id update and continues to mark
  the chat cancellation post as handled in the same row write;
- recurring-series cancellation preserves the existing child-first, then
  parent update order and the exact `parent_event_id`/`id` filters;
- a series request for a non-series event safely retains single-event behavior;
- complete write failures still propagate their original error;
- one-sided series commits now produce the same explicit partial-commit result
  used by the page to refresh committed state and avoid misleading success;
- cancellation chat posting, recipient counting, notification delivery and
  user-facing completion remain page-owned and unchanged.

Verification: 7 direct cancellation-workflow cases plus 45 Event Detail
behavior contracts pass (52 focused tests). TypeScript passes and
`git diff --check` is clean.

Known pre-existing reliability gap, deliberately unchanged: recurring-series
cancellation is two independent database updates rather than one atomic backend
operation. A failure between them can leave only the children or only the
parent cancelled. The UI now continues to report and refresh that partial state,
but eliminating the possibility requires separate defect work and an atomic
RPC/database transaction; it must not be mixed into this structural tranche.

The second lifecycle slice extracts bulk and individual RSVP reminder
coordination:

- bulk reminders fail closed if RSVP state, eligible recipient resolution or
  cooldown history cannot be read;
- targeted/team/club/mini-league audience resolution remains delegated to the
  existing shared recipient policy;
- responders and recipients inside the 24-hour cooldown are excluded before a
  single notification insert;
- individual child reminders preserve fail-closed primary-parent and additional
  guardian lookup, stable deduplication and cooldown filtering;
- notification insert failures propagate and cannot be reported as success;
- toast wording, recent-reminder UI state, sharing and dialogs remain
  page-owned;
- resend-invite delivery remains separate because it intentionally combines
  `skip_push` notification rows with explicit best-effort push invocations.

Verification: 6 direct reminder-workflow tests, 11 recipient-policy tests and
45 Event Detail behavior contracts pass (62 focused tests). TypeScript passes
and `git diff --check` is clean.

The third lifecycle slice extracts resend-invite persistence separately from
push delivery:

- the shared event-recipient policy remains authoritative for team, club,
  targeted and mini-league audiences;
- the event creator and duplicate role rows are excluded before history lookup;
- previously invited members are excluded using exact event/type history;
- new notification rows retain `skip_push: true` and the existing payload;
- recipient, history and insert failures all stop before any explicit push;
- only recipient ids whose notification rows committed return to the page, which
  then retains the existing best-effort per-recipient Edge Function invocation.

Verification: 5 direct resend-workflow tests plus reminder workflow/recipient
policy and Event Detail behavior contracts pass (67 focused tests). TypeScript
passes and `git diff --check` is clean.

The fourth lifecycle slice extracts duty-completion persistence and its
notification boundary:

- completion retains the conditional `id` plus `status = open` update, making
  concurrent/repeated taps an idempotent no-op;
- a duty update error remains a complete failure and sends no notifications;
- team duties retain the team-admin/coach/club-admin/committee audience, while
  club-wide duties retain the narrower club-admin/committee audience;
- the acting member, null identities and duplicate role rows are excluded;
- manager-read or notification-write failures after the duty commits retain an
  explicit partial-success error, so the UI refreshes committed state and never
  implies the duty remained open;
- duplicate notification conflicts remain intentionally tolerated;
- the event-time completion gate and all toast/cache behavior remain page-owned.

Verification: 6 direct duty-completion tests plus 45 Event Detail behavior
contracts pass (51 focused tests). TypeScript passes and `git diff --check` is
clean.

The fifth and final lifecycle slice extracts only the administrator payment
ledger toggle:

- marking paid retains the exact event/member/amount/status/timestamp row;
- removing paid status remains scoped by both event and member;
- denied insert and delete operations propagate and cannot trigger cache refresh
  or success UI;
- checkout initiation, native/web navigation, processing locks, status-listener
  cleanup and server-side confirmation remain in Event Detail because they are
  cohesive UI/platform orchestration rather than reusable persistence policy;
- the existing checkout contracts continue to cover provider failure, missing
  URLs, repeated taps, native deep links, terminal callbacks, confirmation
  failure and unmount cleanup.

Verification: 4 direct payment-ledger cases plus 45 Event Detail behavior
contracts pass (49 focused tests). TypeScript passes and `git diff --check` is
clean.

E5 is closed. Further extraction of checkout or the small add/claim/reopen/delete
duty mutations would add indirection without materially improving safety or
maintainability. The next phase is E6 page composition, beginning with a
read-only inventory of cohesive presentation sections before moving any JSX.

## E6 progress — 12 August 2026

The composition inventory found that the details card is not a safe first
boundary: it combines calendar export, attendance identity/counting and
PitchBoard access/resume behavior. Attendance, duties, payments, reminders and
game tools likewise remain orchestration-heavy even where workflow policy has
already been extracted. They must be split only behind narrow primitive props,
not a page-sized context object.

The first presentation slice extracts the event identity header:

- title, cancellation badge, club label and optional team label now form one
  stateless component;
- the component owns no query, mutation, routing, cache or permission behavior;
- three direct rendering contracts cover complete, cancelled and partially
  populated event identity;
- Event Detail retains the exact placement and data source.

Verification: 3 direct header tests plus 45 Event Detail behavior contracts
pass (48 focused tests). TypeScript passes and `git diff --check` is clean.
`EventDetailPage.tsx` is 3,865 lines after this deliberately small first move.

The second presentation slice isolates location rendering without changing its
page placement:

- a shared pure policy preserves map-address priority: structured address,
  legacy location, then venue name;
- the details-card venue row preserves structured locality formatting and the
  distinct venue/legacy-location fallback;
- matching venue and legacy values render once;
- the map remains after the match-score section and retains its exact iframe
  styling and accessibility title;
- absent location data renders neither venue content nor a map.

Verification: 4 direct location presentation/policy tests plus 45 Event Detail
behavior contracts pass (49 focused tests). TypeScript passes and
`git diff --check` is clean. `EventDetailPage.tsx` is now 3,846 lines.

The third presentation slice isolates the date/calendar row and its export
contract:

- the stateless row preserves date formatting and the accessible calendar
  action styling;
- a small command boundary builds the complete ICS event payload, including
  times, description, location, cancellation/update metadata and share URL;
- exporter failures propagate to Event Detail, which retains the existing
  success and destructive-error toast behavior;
- PitchBoard timing/access and attendance counting remain outside this
  component.

Verification: 1 direct row interaction test, 2 export-command tests and 45 Event
Detail behavior contracts pass (48 focused tests). TypeScript passes and
`git diff --check` is clean. `EventDetailPage.tsx` is now 3,819 lines.

The fourth presentation slice extracts passive event facts:

- game opponent and arrival guidance render only for games;
- arrival guidance requires both a formatted time and minute offset, avoiding
  partial/misleading text;
- positive social-event prices retain two-decimal per-person formatting;
- zero, null and absent prices remain hidden;
- attendance counting and PitchBoard controls remain page-owned and unchanged.

Verification: 7 direct fact-rendering cases plus 45 Event Detail behavior
contracts pass (52 focused tests). TypeScript passes and `git diff --check` is
clean. `EventDetailPage.tsx` is now 3,800 lines.

The fifth presentation slice separates attendance-summary policy from display:

- social events preserve adult/child counts and count guests as adults;
- game/training summaries include direct children, linked mini-league children,
  standalone mini-league players and adult members with a player role;
- child identity wins and duplicate direct/mini-league representations count
  once;
- non-player adults and non-going responses remain excluded;
- successfully loaded empty attendance renders zero, while missing data retains
  distinct loading and unavailable states;
- the display component owns only accessible summary wording and pluralization.

Verification: 4 direct calculation-policy tests, 3 display contracts and 45
Event Detail behavior contracts pass (52 focused tests). TypeScript passes and
`git diff --check` is clean. `EventDetailPage.tsx` is now 3,767 lines.

The sixth presentation slice separates PitchBoard action timing from board
ownership:

- future games beyond 120 minutes offer lineup/auto-sub preparation;
- the exact 120-minute boundary through kickoff offers Start Game;
- kickoff through exactly three hours offers Open Match, after which the manager
  action is hidden;
- access/member loading remains limited to supported team games;
- manager and independently authorized read-only actions retain their existing
  labels, styling and open callback;
- access queries, sticky resume authorization, board state, team data and the
  modal remain owned by Event Detail.

Verification: 10 timing/access policy cases, 4 action interaction cases and 45
Event Detail behavior contracts pass (58 focused tests). TypeScript passes and
`git diff --check` is clean. `EventDetailPage.tsx` is now 3,723 lines.

The seventh presentation slice isolates match-score visibility and composition:

- only team games visible to a team member or event manager render the score;
- viewing remains independent from `canOperateMatch`, which alone controls edit
  capability;
- explicit opponent data wins, with title fallback supporting `v`, `vs.` and
  `versus` forms;
- missing team names retain the existing `Our Team` fallback;
- the underlying sport-aware Match Score component and all persistence remain
  unchanged.

Verification: 11 score visibility/opponent policy cases, 2 section composition
contracts and 45 Event Detail behavior contracts pass (58 focused tests).
TypeScript passes and `git diff --check` is clean. `EventDetailPage.tsx` is now
3,719 lines.

The eighth presentation slice extracts administrator action visibility and the
dropdown while leaving dialog/mutation ownership in Event Detail:

- non-managers see no action menu;
- active events retain edit and cancel, while deletion remains available for
  cancelled events;
- reminder and resend actions remain upcoming-only;
- Pro reminder entitlement retains enabled, resolved-Free disabled and
  entitlement-loading hidden states;
- the existing event-date/end-time/start-time fallback determines upcoming
  status without behavioral change;
- menu actions only invoke controller callbacks; reminder, resend, cancellation
  and deletion dialogs and mutations remain page-owned.

Verification: 5 action/date policy tests, 3 menu authorization/interaction
contracts and 45 Event Detail behavior contracts pass (53 focused tests).
TypeScript passes and `git diff --check` is clean. `EventDetailPage.tsx` is now
3,672 lines after obsolete imports are removed.

The ninth presentation slice extracts the reminder and resend confirmation
dialogs as controlled components:

- open state and mutation invocation remain page-owned;
- reminder sharing still closes the dialog before invoking the existing native/
  web sharing controller;
- pending mutation state and attendance-read safety state independently disable
  delivery actions;
- labels, descriptions, responsive footer layout and loading feedback remain
  unchanged;
- mutation errors and success handling remain in the previously extracted
  workflows/page callbacks.

Verification: 5 dialog interaction/safety cases plus 45 Event Detail behavior
contracts pass (50 focused tests). TypeScript passes and `git diff --check` is
clean. `EventDetailPage.tsx` is now 3,621 lines.

The tenth and final presentation slice extracts cancellation/deletion dialog
selection and composition:

- single and recurring cancellation retain their distinct dialog components,
  custom-message/push choices and exact single/series scopes;
- single and recurring deletion retain exact scope callbacks;
- single deletion still prevents default dialog closure while its awaited write
  is pending, and recurring deletion retains `keepOpenOnAction`;
- mutation state, cancellation partial-failure handling, deletion navigation and
  cache/toast behavior remain page-owned.

Verification: 4 direct lifecycle-dialog scope/pending contracts plus 45 Event
Detail behavior contracts pass (49 focused tests). TypeScript passes and
`git diff --check` is clean. `EventDetailPage.tsx` is now 3,552 lines after
obsolete lifecycle-dialog imports are removed.

E6 is closed. The duties section was assessed and deliberately left intact: it
combines Pro entitlement presentation, temporal completion gates, assignment
state, member/manager actions, sheets and multiple mutations. Moving it now
would require a broad callback/prop interface that relocates rather than reduces
complexity. The attendance body, checkout controller and PitchBoard modal are
also intentionally retained for the same reason. Further splitting should be
driven by a future feature or defect, not line-count reduction.

## E0 progress — 11 August 2026

Added and verified without changing production code:

- direct role-resolution coverage for club admin, committee member, team coach,
  mini-league manager, ordinary member, and app-admin override;
- sensitive read gating for targeted rosters, payments, and match-only markers;
- guardian/direct-child RSVP composition for targeted events, including
  out-of-scope filtering, deduplication, and adults-only events;
- create/edit payload parity for mini leagues, byes, arrival details, social
  payment/guest settings, grouping, multi-team targets, reminders, recurrence,
  duties, and aligned timestamps;
- training conflict-query characterization, including recurring parents;
- a standard-team Playwright journey covering form selection, transactional
  creation with duties, navigation, and correct team detail rendering.

Focused result: 48 Vitest checks and 8 Playwright journeys pass.

Still desirable before changing the corresponding high-risk slices:

- reminder-recipient policy extracted to a directly testable domain helper;
- one local-Supabase standard-team lifecycle/RLS scenario (the existing local
  lifecycle and club-wide journeys already cover much of the database path).

### Defect exposed by E0

The first defect—RSVP query failures being presented as empty attendance—was
fixed and verified after merging from `main`. The page now renders one
accessible alert, provides one RSVP-only retry action, disables unsafe actions
on a fresh failure, and preserves cached attendance during background failures.

The reminder-recipient characterization subsequently exposed a second existing
defect. Bulk reminders for a targeted club-wide event ignore
`target_team_ids`: the mutation re-queries every `user_roles` row in the club
and notifies all non-responders, including members of uninvited teams and
club-level officials with no audience link. Cooldown and recipient deduplication
still work, but the audience boundary does not. Its regression test remains red
until the production selection policy is corrected.

The adjacent `resendInvites` operation independently rebuilds the same
whole-club audience and has the same targeted-event defect. It both inserts an
`event_invite` notification and invokes push delivery for uninvited-team members
and unrelated club officials. Individual child reminders are not affected:
primary-parent/guardian deduplication, partial cooldown, missing-link failure and
denied-write propagation all passed their focused characterization tests.

## Objective

Make event creation, editing, attendance and lifecycle management easier for a
vendor to understand and safely change while preserving permissions, RLS
expectations, RSVP ownership, recurring-series semantics, notification and chat
side effects, payments and PitchBoard entry.

The intended dependency direction is:

`page UI -> controller/hook -> workflow/read repository -> Supabase contract`

This is a structural programme, not a feature redesign. Implementation stays on
`codespaces-review` until focused and complete verification passes. Nothing is
promoted to `main` without manual review and explicit approval.

## Current shape

| Surface | Lines | Primary responsibilities |
| --- | ---: | --- |
| `EventDetailPage.tsx` | 4,427 | Event/RSPV/roster reads, permissions, payments, duties, attendance, cancellation, reminders, awards, sharing and PitchBoard entry |
| `CreateEventPage.tsx` | 1,810 | Scope selection, recurrence, time/duration, conflicts, targeting, duties and atomic creation |
| `EditEventPage.tsx` | 1,523 | Permission resolution, occurrence/series editing, targeting and atomic duty synchronization |
| `EventsPage.tsx` | 1,307 | Membership-derived read scope, online/offline schedule loading, filters, calendar/list presentation and cache recovery |

The largest risk is not line count alone. `EventDetailPage` combines many
independent business transactions and several overlapping interpretations of
event membership, manager access and attendance audience.

## Existing protection

The current baseline already provides strong coverage for:

- personal and child RSVP create/update failure semantics;
- admin RSVP RPC boundaries;
- event deletion confirmation and cache behavior;
- single and recurring cancellation, including partial commits;
- payment checkout, callback verification, retry and listener cleanup;
- duty creation, claim, assignment, completion and failure reporting;
- reminder cooldown, recipient deduplication and invite resend ordering;
- club-wide grade/team grouping and multi-team targeting;
- create-event scope validation and atomic `create_event_with_duties` usage;
- edit-series atomic RPC and atomic duty synchronization;
- cross-club RLS, targeted-event visibility and RSVP revocation;
- Android/iOS PitchBoard restoration and event entry through the wider baseline.

At the starting checkpoint, the complete baseline passes 4,553 frontend tests,
138 isolated Playwright journeys and 258 isolated local-Supabase integration
tests. Three dependency-monitoring tests are intentionally skipped.

## Material E0 gaps

Only gaps needed to make the planned extractions safe should be added. Do not
create broad snapshots or duplicate backend RLS tests in component mocks.

Ranked by refactoring risk:

1. **Event detail read-model failure and isolation.** Directly characterize the
   event, RSVP, guest, duty and payment query boundaries so errors cannot become
   false empty states and unrelated event rows cannot enter the model.
2. **Manager capability matrix.** Characterize app admin, club admin,
   committee, team admin/coach, league admin, Subs Manager and ordinary member
   permissions for edit, cancellation, attendance management, reminders,
   payments and PitchBoard access.
3. **Targeted attendance composition.** Protect multi-team adult/child roster
   merging, shared guardians, duplicate roles, unknown children and grouping by
   grade versus team.
4. **Create payload matrix.** Assert exact atomic RPC payloads for team events,
   whole-club events, targeted multi-team games, mini-leagues and recurring
   events, including duties and RSVP audience fields.
5. **Edit payload matrix.** Assert exact occurrence versus series payloads,
   target-team/grouping changes, scope validation and duty synchronization.
6. **Conflict checking.** Protect team, venue and recurrence conflict queries,
   override behavior, query failure behavior and repeated-submit suppression.
7. **Reminder recipient policy.** Directly protect individual child guardian
   fan-out, shared-guardian deduplication, target-team boundaries and cooldown
   behavior without testing provider internals.
8. **RSVP ownership matrix.** Complete the existing coverage for a second
   guardian updating an existing child RSVP, offline queue fallback and
   mini-league player ownership.
9. **Schedule read scope and offline recovery.** Characterize membership-derived
   team/club/league scope, event visibility filters, cached fallback and
   fail-closed behavior when membership reads fail.
10. **One complete standard-team journey.** Add one durable Playwright journey
    covering create, edit, RSVP, attendance and cancel for a normal team event;
    the existing comprehensive journey is specialized to club-wide games.

Payment, deletion and base duty tests are already sufficiently strong. Add no
more tests there unless an extraction exposes a genuinely unprotected branch.

## Staged refactoring

### E0 — Characterization gate

- Add the ten material contracts above using pure/unit tests for policy,
  component characterization for query/mutation composition, one Playwright
  journey for the complete normal-team flow, and local Supabase only where
  backend enforcement is the behavior under test.
- Run the focused event estate and classify every failure as production defect,
  harness defect or inaccurate expectation before changing behavior.
- Do not refactor production code in this stage except a minimal export that is
  essential for non-brittle testing and preserves runtime behavior.

### E1 — Shared event domain and capability policy

- Extract typed event scope, audience, recurrence and capability decisions.
- Consolidate manager/action availability without moving backend authorization
  into the frontend.
- Keep public page behavior, labels and route contracts unchanged.

Gate: capability matrix, scope validation, entitlement and local RLS suites.

### E2 — Event read repositories

- Extract event detail, RSVP, guest, duty, payment, award and scoped-roster
  reads into feature-local repositories with explicit query failure behavior.
- Extract schedule membership/scope resolution and event-list reads separately.
- Centralize only event-owned query keys; do not perform an app-wide cache-key
  migration.

Gate: read isolation, error propagation, offline schedule and targeted-roster
tests.

### E3 — Create and edit workflows

- Extract form-to-payload mapping, recurrence generation and conflict policy as
  pure functions.
- Extract atomic create, occurrence edit, series edit and duty-sync workflows.
- Preserve the existing RPC names, argument shapes, retry behavior and
  double-submit guards.

Gate: create/edit payload matrices, series transaction, duty transaction,
scope validation and club-wide Playwright coverage.

### E4 — RSVP and attendance orchestration

- Extract personal, child, admin and mini-league RSVP workflows behind explicit
  ownership inputs.
- Extract targeted roster composition and attendance grouping.
- Preserve offline queuing, points, cache invalidation and guardian semantics.

Gate: RSVP matrix, guardian integrity, attendance components and local event
lifecycle journeys.

### E5 — Event lifecycle side effects

- Extract duties, cancellation, reminder/resend and payment coordinators as
  separate workflows. Do not combine them in one service.
- Retain explicit partial-commit results where a database mutation succeeds but
  a best-effort notification or chat post fails.
- Do not alter Edge Functions, schema, RLS or provider contracts in this
  structural tranche.

Gate: existing Event Detail characterization, payment, notification fan-out,
duty and cancellation suites.

### E6 — Page composition and presentation

- Split cohesive sections only after their policy and workflows are outside the
  page: header/actions, attendance, duties, payments, reminders and game tools.
- Keep loading, error, empty and permission-denied states explicit.
- Avoid a generic mega-context or prop object that merely moves complexity.

Gate: focused component tests, accessibility assertions and affected
Playwright journeys.

### E7 — Closeout

- Run focused event tests, TypeScript, targeted lint and production build.
- Run the full one-click baseline against the isolated local stack.
- Record final line counts, remaining risks and known legacy lint debt.
- Perform manual Codespaces UI review of normal team, club-wide, targeted,
  recurring and mini-league events on desktop and mobile-like viewports.
- Promote only after explicit approval; keep rollback possible per slice.

## Slice and rollback policy

- One independently reviewable commit per boundary.
- Never mix a discovered production defect into a refactoring commit.
- Before each slice, record exact public contracts and run its focused tests.
- After each slice, inspect Supabase tables/RPCs, filters, query keys,
  invalidations, permissions and user-visible failure messages for drift.
- Revert the individual slice if behavior differs; do not weaken a test to make
  an accidental change pass.

## Explicit non-goals

- no UI redesign;
- no event feature changes;
- no schema, migration, RLS or Edge Function changes;
- no payment-provider or notification-provider changes;
- no recurrence algorithm redesign;
- no global repository abstraction;
- no mass TypeScript or lint cleanup;
- no snapshot tests used as a substitute for behavioral assertions.

## Stop conditions

Pause the tranche if a slice:

- changes who can see or manage an event;
- changes RSVP ownership or guardian behavior;
- changes target-team, role-audience or club/team scope;
- changes recurrence or cancellation cardinality;
- changes notification, chat, payment or duty delivery guarantees;
- requires a backend contract change;
- produces an unexplained focused or baseline failure;
- cannot be independently reviewed and reverted.

## Recommended immediate action

Implement E0 as a bundled but test-only stage, starting with event-detail read
isolation and the capability matrix. Review any genuine defect before fixing
it. Begin E1 only after E0 is green.

## E7 closeout checkpoint — 2026-08-13

E0 through E6 are implemented on `codespaces-review`; no tranche has been
promoted to `main`. The closeout verification established:

- focused Events estate: 52 files / 406 tests passed;
- TypeScript: passed;
- production build: passed (only the pre-existing chunk, Browserslist,
  dynamic-import and Tailwind ambiguity warnings remain);
- full frontend Vitest after contract-harness alignment: 450 files / 4,912
  passed / 3 intentional skips;
- isolated Playwright: 139/139 passed;
- local Supabase integration: 32 files / 258 tests passed;
- isolated Supabase cleanup: passed, with no test containers or data volumes
  remaining;
- `git diff --check`: passed.

The first one-click run reported nine frontend failures across five files.
Investigation classified all nine as test-harness drift caused by boundaries
moving out of monolithic pages: transactional event/duty RPCs, event mutation
completion, PitchBoard action labels, reminder/resend disabled state, and the
Home candidate limits. Test-only contracts were redirected to those extracted
boundaries; no production behavior was changed to make the baseline green.

`EventDetailPage.tsx` is now 3,552 lines, down from 3,870 at tranche start (318
lines / 8.2%). More importantly, business decisions and multi-step mutations
now have separately testable policy, repository, workflow and presentation
boundaries. Create, Edit and Events pages remain large and are candidates for
a later bounded tranche, not for further work inside this closeout.

Targeted lint currently reports 389 findings (378 errors and 11 warnings),
dominated by longstanding `no-explicit-any` and hook-dependency debt across the
legacy pages and extracted seams. This is documented debt rather than a safe
reason for a mass typing rewrite during behavioral refactoring.

Outstanding before promotion:

- manual Codespaces UI review on desktop and mobile-like viewports for normal
  team, club-wide, targeted-team, recurring and mini-league events;
- review the uncommitted tranche as a whole and preserve slice-level rollback;
- obtain explicit approval before any merge or promotion to `main`.
