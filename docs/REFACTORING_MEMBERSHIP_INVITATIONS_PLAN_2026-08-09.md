# Ignite Club HQ — Membership and Invitations Refactoring Plan

**Established:** 9 August 2026
**Development branch:** `codespaces-review`
**Status:** MI1–MI8 complete on the cumulative integration branch; automated closeout passed; MI-D1/MI-D2 remain recorded debt; delegated manual acceptance and promotion pending. See `REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md`.

## Objective

Reduce the change cost and security risk of membership and invitation work while
preserving existing roles, club/team isolation, child/guardian relationships,
delivery behavior and partial-failure reporting. Refactoring is performed only
in Codespaces and is not promoted to `main` without explicit approval.

## Safety boundaries

- No schema, RLS, Edge Function or hosted-environment changes are part of this
  programme.
- Behavioural defects discovered during extraction are reported and fixed
  separately from refactoring.
- Existing-user, email-invite and share-link workflows must retain their exact
  write ordering and truthful success/failure reporting.
- Child deduplication and multiple-guardian relationships must remain fail-safe.
- Each slice receives focused tests and the complete baseline before promotion.

## Staged implementation

### MI1 — Pure invitation policy

- Extract team-role types, team-type role availability, default-role selection
  and role labels.
- Keep UI state, Supabase reads and mutations in `AddTeamMemberSheet`.
- Directly test junior, senior and mixed policy boundaries.

**Completed 9 August 2026:**

- Extracted typed team roles, team types, role availability, default selection
  and user-facing label lookup into `src/features/membership`.
- Rewired `AddTeamMemberSheet` without moving its React state, Supabase reads,
  mutations, query keys or delivery behavior.
- Added eight direct contracts covering junior/senior/mixed availability,
  defaults, label fallback and immutable shared policy.
- Focused verification passes 101/101 tests across six files; the new policy
  boundary passes targeted lint and the production build succeeds.

### MI2 — Identity and child matching

- Extract normalized member-name matching and confirmed/pending child result
  composition.
- Preserve minimum search lengths, confirmed-first ordering, deduplication and
  five-result limit.

**Completed 9 August 2026:**

- Extracted exact case-insensitive member-name matching and combined confirmed/
  pending child matching into the typed invitation policy boundary.
- Preserved the three-character exact member threshold, two-character partial
  child threshold, confirmed-first order, confirmed-name suppression of pending
  matches and five-result cap.
- Characterized the existing rule that duplicate pending results remain when
  no confirmed child supersedes them; this was not silently redesigned.
- Added six MI2 contracts. Focused verification passes 107/107 tests across six
  files; targeted lint and the production build pass.
- The first focused run caught a refactoring-only omitted named import before
  completion. The import was restored and the full focused gate rerun green.

### MI3 — Read repositories

- Extract existing membership, club child, pending-invite child and profile
  search reads behind typed feature repositories.
- Preserve query keys, enablement and loading ownership in the component.

**MI3a completed 9 August 2026:**

- Extracted exact-team member ID retrieval, cached member-profile retrieval and
  exact-club invitation branding into a typed read repository.
- Preserved all React Query keys, enablement, cache ownership and existing
  empty/null/error fallbacks in `AddTeamMemberSheet`.
- Added six repository contracts covering exact filters and selected columns,
  source ordering, empty-scope short-circuiting and unchanged null results.
- Focused verification passes 113/113 tests across seven files; repository and
  policy lint passes and the production build succeeds.
- Club-child, pending-invite-child and profile-search reads remain component-
  owned for MI3b and later slices.

**MI3b completed 9 August 2026:**

- Extracted the club-child read model spanning exact-club teams, team
  assignments, exact-club parent roles, parent-owned children, final child
  detail rows and cached parent profile enrichment.
- Preserved team-discovered-first ordering, cross-path child-ID deduplication,
  source row ordering, null-parent handling and the existing `Unknown` label.
- Added four direct contracts for both discovery paths, clubs without teams,
  empty-scope short-circuiting and missing/null parent profiles.
- Focused verification passes 117/117 tests across seven files; targeted lint,
  diff validation and the production build pass.
- Pending-invite-child and profile-search reads remain component-owned for
  MI3c and later slices.

**MI3c completed 9 August 2026:**

- Extracted exact-team pending-invite reads and deterministic reconstruction of
  pending child matches from JSON metadata.
- Preserved pending-status filtering, source order, normalized-name/year
  deduplication, parent-label fallback and malformed-metadata tolerance.
- Added four contracts for exact query scope, malformed metadata,
  deduplication/order and existing year/label fallbacks.
- Focused verification passes 121/121 tests across seven files; targeted lint,
  diff validation and the production build pass.
- Profile and secondary-parent searches remain component-owned for MI3d.

**MI3d completed 9 August 2026:**

- Extracted the bounded `search_invitable_profiles` RPC, exact-club pending-
  invite search with cached linked-profile enrichment, and single second-parent
  profile search into the typed repository.
- Preserved two-character thresholds, raw query text, RPC limit 8, pending-only
  club filter, pending result limit 12, profile-label fallback and second-parent
  limit 5.
- Added five contracts for RPC payloads, short-circuiting, exact pending search
  scope/enrichment, absent-profile fallback and parent-search columns/bounds.
- Focused verification passes 126/126 tests across seven files; targeted lint,
  diff validation and the production build pass.
- Identity-map enrichment plus bulk member and bulk second-parent searching
  remain component-owned for MI3e.

**MI3e completed 10 August 2026:**

- Extracted exact-club member identity composition across roles, team labels
  and parent/child relationships.
- Extracted concurrent bulk candidate searches while preserving the current-
  user exception, parent-role exception, existing-member exclusion, profile-
  before-pending ordering, exact pending scope and per-term result grouping.
- Extracted concurrent bulk second-parent searches with stable term ordering.
- Added five contracts for identity output/scope, empty-scope short-circuiting,
  bulk filtering/order, the parent exception and multi-term parent results.
- Focused verification passes 131/131 tests across seven files; targeted lint,
  diff validation and the production build pass.
- MI3 read-model extraction is complete. Mutation orchestration remains in the
  component for MI4 onward.

### Deferred defect MI-D1 — UUID pending-child references

The existing canonical-reference parser uses
`/^pending-([^-]+)-.*$/` against IDs shaped as
`pending-${inviteId}-${childName}`. Real invite IDs are UUIDs containing
hyphens, so the parser normally extracts only the UUID's first segment and
cannot find the referenced invite. The child then remains attributed to the
current invite rather than its canonical source invite.

MI3c deliberately preserved this behaviour rather than hiding a product fix
inside refactoring. Fix MI-D1 separately by resolving against the known invite
IDs (not by splitting a UUID at `-`), with regression cases for UUIDs, names
containing hyphens, absent references and cross-invite deduplication.

### MI4 — Existing-user membership workflow

- Extract role assignment, guardian linking, child assignment and membership
  notification orchestration.
- Preserve duplicate-role idempotency and partial-failure reporting.

**MI4a completed 10 August 2026:**

- Extracted exact existing-user team-role insertion and duplicate-error
  classification into a typed mutation service.
- Preserved PostgreSQL `23505`, legacy duplicate/unique-message fallbacks and
  original non-duplicate error propagation.
- Reused the extracted duplicate classifier in existing second-parent and bulk
  role paths without otherwise moving those workflows.
- Added six direct contracts for exact scope/payload, successful insertion,
  every supported duplicate form, unrelated errors and original-error identity.
- Focused verification passes 137/137 tests across eight files; targeted lint,
  diff validation and the production build pass.
- Child creation/linking, guardians, team assignments, jersey positions and
  notifications remain component-owned for later MI4 slices.

**MI4b completed 10 August 2026:**

- Extracted existing-child guardian linking and secure new-child creation into
  the typed mutation service.
- Preserved primary-parent short-circuiting, duplicate guardian idempotency,
  exact child/guardian identifiers, exact RPC arguments, input trimming/year
  parsing and original backend-error propagation.
- Kept user-facing child-creation error wording/logging and all subsequent team
  assignment, position, second-parent and notification behavior in the page.
- Added six contracts covering primary-parent no-write, successful/duplicate
  guardian links, permission/FK/merged-child failures, exact secure RPC payload
  and null-year/error handling.
- Focused verification passes 143/143 tests across eight files; targeted lint,
  diff validation and the production build pass.

**MI4c completed 10 August 2026:**

- Extracted exact child/team assignment lookup and insertion plus jersey-
  position update/creation into the typed mutation service.
- Preserved already-assigned idempotency, assignment-error blocking, existing-
  position updates by row ID, default `MID` insertion, `parseInt` handling and
  no-write behavior for absent/invalid jersey values.
- Preserved the established best-effort jersey semantics while keeping the
  page's truthful “child saved but team assignment failed” error wording.
- Added six direct contracts for assignment idempotency/success/failure,
  position update/insert and invalid/absent jersey values.
- Focused verification passes 149/149 tests across eight files; targeted lint,
  diff validation and the production build pass.

**MI4d completed 10 August 2026:**

- Extracted existing second-parent role insertion, all resolved-child guardian
  writes and membership notification into typed sequential orchestration.
- The service now returns structured role, per-child guardian and notification
  outcomes, directly covered for success, duplicates and each failure stage.
- Preserved current page behavior during refactoring: it logs a non-duplicate
  role error and continues, and still sets `secondParentAddedDirectly` after the
  sequence. The reporting defect below was not silently fixed.
- Added five contracts covering exact writes, duplicate role idempotency,
  continued processing after role/guardian failures and notification failure.
- Focused verification passes 154/154 tests across eight files; targeted lint,
  diff validation and the production build pass.

**MI4e completed 10 August 2026:**

- Extracted the primary existing-member notification write and explicit
  notification-only failure mapping into the typed mutation service.
- Preserved the exact membership notification payload, existing role-label
  interpolation and page-owned partial-success toast/email behavior.
- Added three contracts for exact successful delivery, truthful write failure
  and the existing missing-label fallback.
- Focused verification passes 157/157 tests across eight files; targeted lint,
  diff validation and the production build pass.

**MI4f completed 10 August 2026:**

- Composed the primary-parent child sequence from the extracted guardian,
  creation, assignment and jersey services behind one typed workflow boundary.
- Preserved sequential order, stable resolved-child results, pending-invite
  skips, existing-child year precedence and all downstream metadata inputs.
- Preserved distinct child-creation and saved-but-unassigned user-facing error
  wording while ensuring later writes stop at the same failure point.
- Added six composition contracts for existing/new/pending/blank children,
  creation and assignment failures, ordering and multi-child stability.
- Focused verification passes 163/163 tests across eight files; targeted lint,
  diff validation and the production build pass.

### Deferred defect MI-D2 — second-parent false success

The existing-user second-parent path reports `secondParentAddedDirectly: true`
even when the role insert is denied, one or more guardian links fail, or the
membership notification fails. It can therefore show “Second parent added”
although that parent lacks the intended membership or child access.

MI4d exposes all outcomes without changing the UI. Fix MI-D2 separately by
defining required success (role duplicate/success plus every guardian link),
distinguishing notification-only partial success, retaining failed-child IDs
for retry, and preventing complete-success messaging on incomplete state.

### MI5 — Pending invitation workflow

- Extract pending-invite construction, email/share delivery and delivery-state
  recording.
- Preserve normalized identity, exact scope, retry behavior and manual-link
  recovery after provider failure.

**MI5a completed 10 August 2026:**

- Extracted primary pending-team-invitation construction and insertion into the
  typed mutation service.
- Preserved exact team, club, role, inviter and token scope; trimmed names;
  normalized email to lowercase or `null`; and retained parent-only child and
  optional second-parent metadata behavior.
- Preserved the selected `id`/`short_code` result, original backend errors and
  the existing null-result behavior without introducing a hidden product fix.
- Added five contracts covering exact parent payloads, selected second-parent
  metadata, non-parent metadata exclusion, insertion failure and null results.
- Focused verification passes 168/168 tests across eight files; all extracted
  membership modules pass lint and the production build succeeds. The legacy
  `AddTeamMemberSheet` still has 49 pre-existing file-level lint violations,
  tracked as existing refactoring debt rather than changed in this slice.

**MI5b completed 10 August 2026:**

- Extracted secondary-parent pending-invitation construction and insertion into
  the typed mutation service.
- Preserved exact parent role and team/club/inviter scope, normalized identity,
  linkage to the primary invitation, and null metadata when no child metadata
  exists.
- Preserved the existing best-effort behavior: a failed secondary invitation
  does not throw or produce a secondary share link. The service now exposes the
  original error for a later truthful-reporting product fix without changing UI.
- Added three contracts for exact linked payload, null metadata and insertion
  failure. Focused verification passes 171/171 tests across eight files;
  targeted lint, diff validation and the production build pass.

**MI5c completed 10 August 2026:**

- Extracted primary-invitation provider-result verification and delivery-state
  persistence into the typed mutation service.
- Preserved the strict requirement for both `verified` and `success`, transport-
  error precedence, provider ID retention, fallback error wording, exact token
  scope and the existing manual-link success path after delivery failure.
- Exposed delivery-state write errors without changing the current UI behavior
  or falsely converting an email-provider success into a thrown mutation error.
- Added seven contracts covering verified success, incomplete/malformed provider
  responses, provider rejection, transport failure and status-write failure.
  Focused verification passes 178/178 tests across eight files; targeted lint,
  diff validation and the production build pass.

**MI5d completed 10 August 2026:**

- Reused the typed delivery-state boundary for secondary-parent invitation
  emails, removing the remaining inline pending-invite status update.
- Added an explicit compatibility policy for the established secondary-parent
  behavior: invocation errors retain provider/fallback wording rather than the
  primary invitation's transport-error message.
- Preserved verified-success requirements, provider IDs, exact secondary token
  scope, success toast conditions and best-effort failure handling.
- Added two compatibility contracts for invocation fallback and provider-error
  precedence. Focused verification passes 180/180 tests across eight files;
  targeted lint, diff validation and the production build pass.

**MI5e completed 10 August 2026:**

- Extracted shared pending-team-invite email request construction and Edge
  Function invocation for both primary and secondary-parent recipients.
- Preserved all single-child, multi-child and no-child subjects; exact template
  name; recipient and role values; club sender/reply-to/logo fallbacks; optional
  children/custom-message fields; and existing invite links.
- Kept delivery verification and persistence as the separate MI5c/MI5d boundary,
  so provider invocation cannot implicitly mark an invitation as delivered.
- Added five contracts covering the three subject/payload variants, exact
  `send-email` invocation and transport-error return. Focused verification
  passes 185/185 tests across eight files; targeted lint, diff validation and
  the production build pass.

**MI5f completed 10 August 2026:**

- Extracted the existing-account parent email request and invocation boundary,
  reused for the primary parent and both existing second-parent paths.
- Preserved user-ID targeting, single/multiple-child subjects, parent fallback
  name, club branding, optional custom-message differences and the exact team
  deep link used instead of a pending invitation link.
- Preserved best-effort delivery: rejected Edge Function calls remain caught by
  their existing page paths and cannot roll back completed membership writes.
- Added four contracts for the exact singular request, plural/fallback payload,
  unchanged invocation response and rejected invocation. Focused verification
  passes 189/189 tests across eight files; targeted lint, diff validation and
  the production build pass.

### MI6 — Bulk workflow

- Extract per-member validation and sequential/bounded orchestration.
- Preserve per-recipient outcomes; never report partial completion as complete
  success.

**MI6a completed 10 August 2026:**

- Extracted database-free bulk member validation, stable token allocation and
  parent-pair cross-link planning into a typed planner.
- Preserved source order after blank-member filtering, one token per valid
  member, normalized/sorted child-name fingerprints and the established rule
  that only exactly two parents sharing the same fingerprint are cross-linked.
- Preserved no-link behavior for non-parents, blank child sets, different child
  sets, duplicate-name mismatches and groups of three or more parents.
- Added six contracts covering validation, token stability and every pairing
  boundary. Focused verification passes 195/195 tests across nine files;
  targeted lint, diff validation and the production build pass.

**MI6b completed 10 August 2026:**

- Extracted bulk child and second-guardian pending-invite metadata construction
  into the database-free planner.
- Preserved trimmed child identity, `parseInt` prefix behavior, JSON-normalized
  invalid numbers, existing-child IDs, linked tokens and typed second-guardian
  precedence over a selected existing profile.
- Preserved the subtle established rule that all link/guardian metadata is
  discarded when a member has no nonblank children.
- Added six contracts covering exact metadata, numeric edge cases, both guardian
  sources, no-child behavior and absent optional metadata. The first focused run
  exposed and corrected a test identity-assertion mistake; production behavior
  was correct. Final verification passes 201/201 tests across nine files;
  targeted lint, diff validation and the production build pass.

**MI6c completed 10 August 2026:**

- Extracted each new bulk recipient's pending-invitation insertion into the
  typed mutation service.
- Preserved exact team, club, role, inviter and token scope; trimmed names;
  lowercase-or-null email normalization; and the MI6b metadata object.
- Returned the original write error as an explicit per-recipient outcome,
  preserving the existing batch behavior that logs the failed recipient and
  continues processing later recipients rather than aborting the whole batch.
- Added three contracts for the exact normalized write, blank-email/null-
  metadata handling and original insertion failures. Focused verification
  passes 204/204 tests across nine files; targeted lint, diff validation and
  the production build pass.

**MI6d completed 10 August 2026:**

- Extracted new bulk recipients' email invocation, strict provider verification
  and pending-invite delivery tracking into a typed per-recipient service.
- Preserved exact subjects/templates/branding, the bulk-specific empty children
  array, success-only provider IDs, invocation/provider/thrown-error wording,
  exact token updates and no invocation or tracking write for blank emails.
- Exposed tracking-write errors without aborting the batch or falsely changing
  the established `sent` outcome, preserving sequential recipient processing.
- Added seven contracts covering verified success, empty children, invocation
  errors, provider rejection, thrown/unknown failures, blank email and tracking
  failure. Focused verification passes 211/211 tests across nine files;
  targeted lint, diff validation and the production build pass.

**MI6e1 completed 10 August 2026:**

- Extracted only existing-user bulk role assignment and duplicate handling into
  the typed mutation service; child, guardian, notification and result logic
  remains component-owned for later MI6e slices.
- Preserved exact user/team/club/role scope, all established duplicate forms,
  duplicate-as-idempotent continuation and genuine-error recipient skipping.
- Added five contracts for exact success, three duplicate forms and original
  non-duplicate failure. Focused verification passes 216/216 tests across nine
  files; targeted lint, diff validation and the production build pass.

**MI6e2 completed 10 August 2026:**

- Extracted existing-parent bulk child processing and the bulk-specific best-
  effort team-assignment write into typed sequential services.
- Preserved pending-child skips, existing-child guardian linking, new-child
  creation, stable order and exact child/team assignment scope.
- Preserved asymmetric legacy failure behavior explicitly: guardian failures
  abort, child-creation failures skip only that child, and assignment lookup or
  insertion errors remain best-effort and do not abort the recipient.
- Added seven contracts covering existing/new/pending children, creation
  continuation, guardian abort, assignment idempotency and best-effort errors.
  Focused verification passes 223/223 tests across nine files; targeted lint,
  diff validation and the production build pass.

**MI6e3a completed 10 August 2026:**

- Extracted the selected existing second-guardian role and child-link sequence
  from the bulk existing-parent path.
- Preserved role-first ordering, exact scope, links only for child IDs already
  present in the source rows, sequential writes and no writes for unresolved
  newly created children.
- Preserved the current best-effort behavior by continuing after returned role
  or guardian errors, while exposing each error in a typed result for later
  truthful-reporting defect work.
- Added three contracts for exact successful ordering, continued partial errors
  and role-only behavior without existing child IDs. Focused verification
  passes 226/226 tests across nine files; targeted lint, diff validation and
  the production build pass.

**MI6e3b completed 10 August 2026:**

- Extracted pending second-guardian invitation creation and guardian email
  invocation from the bulk existing-parent path.
- Preserved token generation, exact scope, first-existing-child guardian
  reference, all-team metadata, normalized identity, child metadata, branding,
  guardian subject and join link.
- Explicitly preserved and characterized the risky legacy sequence that still
  attempts the email when pending-invite insertion returns an error; both write
  and invocation errors are now exposed without changing batch behavior.
- Added five contracts for exact writes/delivery, insert-error continuation,
  returned and thrown invocation errors, unresolved children and branding
  fallbacks. Focused verification passes 231/231 tests across nine files;
  targeted lint, diff validation and the production build pass.

**MI6e4 completed 10 August 2026:**

- Extracted existing bulk-member membership notification and successful result
  composition into one typed completion boundary.
- Preserved exact notification scope/message, display-name fallback, entered
  email casing, team deep link, role, child count and `sent: true` semantics.
- Preserved notification failure as non-blocking for the already-completed
  membership while exposing the original failure in the service result.
- Added three contracts for exact success, missing label/name fallbacks and
  notification failure. Focused verification passes 234/234 tests across nine
  files; targeted lint, diff validation and the production build pass.

**MI6f1 completed 10 August 2026:**

- Composed the extracted new/pending bulk-recipient operations behind a typed
  per-recipient orchestration boundary.
- Preserved insert-before-delivery ordering, exact normalized write/delivery
  inputs, stable join links and result name/email/role/child-count fields.
- Prevented delivery after invite insertion failure while preserving unsent
  results and manual share links after provider failure or blank email.
- Added four composition contracts for successful ordering, insert failure,
  delivery failure and blank-email recovery. Focused verification passes
  238/238 tests across nine files; targeted lint, diff validation and the
  production build pass.

**MI6f2 completed 10 August 2026:**

- Composed the extracted existing-account bulk operations behind one typed
  per-recipient boundary: role assignment, parent children, optional selected
  or pending second guardian, and final notification/result composition.
- Preserved role-failure short-circuiting, parent-only work, selected-guardian
  precedence, exact operation order and existing completion semantics.
- Added four composition contracts. Focused verification passes 242/242 tests;
  extracted files pass lint and the production build succeeds.

**MI6f3 completed 10 August 2026:**

- Moved the outer mixed existing/pending recipient loop into a dedicated bulk
  workflow module, leaving React Query lifecycle and result presentation in
  `AddTeamMemberSheet`.
- Preserved sequential processing, linked parent tokens, normalized metadata,
  exact role labels, continuation after per-recipient failures and success-only
  result counts.
- Added four batch contracts for mixed ordering, paired-parent metadata and
  both existing and pending failure continuation. Focused verification passes
  246/246 tests; extracted files pass lint and the production build succeeds.

### MI7 — Presentation decomposition

- Split single-member steps, parent/guardian fields, bulk rows and success
  results into typed database-free components.
- Preserve native keyboard, focus, scrolling and accessibility behavior.

**MI7a completed 10 August 2026:**

- Extracted the bulk invitation result sheet into a typed, database-free
  presentation component while retaining clipboard, toast, reset and close
  ownership in `AddTeamMemberSheet`.
- Preserved exact sent/failed/link-only labels, recipient identity, copy-link
  selection, Add More reset and Done behavior.
- Added an accessible sheet description without changing visible behavior and
  four rendering/delegation contracts. Focused verification passes 250/250
  tests; extracted files pass lint and the production build succeeds.

**MI7b completed 10 August 2026:**

- Extracted the single-invitation result and sharing sheet into a typed,
  database-free presentation component while retaining native Share,
  clipboard, window navigation, toasts, reset and close ownership in the page.
- Preserved parent child summaries, email/link-only status, optional phone
  privacy wording, phone sanitization, Android/iOS SMS separators and WhatsApp
  destinations.
- Added five rendering and delegation contracts plus an accessible sheet
  description. Focused verification passes 255/255 tests; extracted files pass
  lint and the production build succeeds.

**MI7c completed 10 August 2026:**

- Extracted the single-invitation wizard footer into a typed, database-free
  presentation component while retaining wizard transitions, mutation choice
  and parent-child row creation in `AddTeamMemberSheet`.
- Preserved empty-name blocking, parent child-name validation, existing-user
  direct submission, email and link-only delivery rules, pending-state guards,
  button labels and accessible inline validation feedback.
- Added seven focused navigation, validation and delegation contracts. The
  broader membership/invitation regression set passes 297/297 tests; extracted
  files pass lint and the production build succeeds. Full parent-file lint
  continues to report its pre-existing `any` and empty-block debt.

**MI7d completed 10 August 2026:**

- Extracted the new-member delivery method and optional custom-message step
  into a typed, database-free presentation component. The parent retains
  delivery state and the established email-clearing behavior when Share Link
  is selected.
- Corrected MI7c's static delivery-method contract from `link` to the existing
  production value `share`; runtime behavior had remained unchanged because
  only email delivery receives special validation.
- Added five focused rendering and delegation contracts. The broader
  membership/invitation regression set passes 302/302 tests; extracted files
  pass lint, the full TypeScript check passes and the production build succeeds.

**MI7e completed 10 August 2026:**

- Extracted the selected-person/role recap and role-selection step into a
  typed, database-free presentation component. Team-type role policy and
  wizard state remain parent-owned.
- Preserved junior/senior role option filtering, current-role accessibility,
  parent child-player guidance, edit shortcuts and the forwarded role-section
  ref used for mobile wizard scrolling.
- Added seven focused rendering, policy-boundary, scrolling and delegation
  contracts. The broader membership/invitation regression set passes 309/309
  tests; extracted-file lint, full TypeScript checking and production build pass.

### MI8 — Closeout

- Run focused membership, guardian, invitation and role suites.
- Run relevant Playwright and isolated local-Supabase journeys.
- Run the complete one-click baseline and record final size/risks.
- Defer promotion until explicitly approved.

**Automated closeout completed 10 August 2026:**

- Focused membership/invitation verification passes 309/309 tests. Extracted
  files pass lint, the full TypeScript check passes and the production build
  succeeds.
- Complete one-click verification passed 4,456 frontend tests (three
  intentional skips) and all 258 isolated local-Supabase tests. All 24
  synthetic migrations applied and cleanup verified that no local test
  containers or volumes remained.
- Playwright passed 135/138 journeys on the initial complete run. Two iOS
  WebKit harness failures (an internal reload error and a one-second click
  timeout) passed immediately on focused rerun. The offline-navigation failure
  was traced to an inaccurate whole-browser-offline model that blocked local
  Vite chunks, plus stale test timing that did not allow the intentional Media
  and Inbox persistence debounce to finish. The journey now models remote API
  loss while retaining packaged frontend assets, and chunk recovery no longer
  hard-reloads an explicitly offline browser. The corrected journey and all
  eight surrounding offline Playwright journeys pass.
- Final complete one-click verification passes 4,458 frontend tests (three
  intentional skips), all 138 Playwright journeys and all 258 isolated local-
  Supabase tests. Cleanup verified that no isolated containers or data volumes
  remained.
- Membership/invitation promotion remains deferred pending manual Codespaces
  UI review and explicit approval. No tranche files have been promoted to
  `main` by this closeout.

## Stop conditions

Pause if a slice requires schema/RLS changes, changes invitation UX, weakens a
permission check, changes role semantics, alters guardian ownership, or changes
notification/email guarantees. Such work is a separate defect or product
change, not hidden refactoring.
