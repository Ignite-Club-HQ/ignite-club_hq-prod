# Ignite Club HQ — Vault Refactoring Plan

**Established:** 7 August 2026
**Development branch:** `codespaces-review`
**Starting checkpoint:** `c83bab566`
**Status:** V1–V8 complete on the cumulative integration branch; automated closeout passed; delegated manual acceptance and promotion pending. See `REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md`.

## Objective

Make Vault easier for a vendor to understand and modify while preserving every
existing permission, entitlement, storage, deletion, navigation and export
behaviour. This is a staged extraction, not a redesign.

`src/pages/VaultPage.tsx` currently contains 5,734 lines and combines:

- club, team, mini-league and folder navigation;
- role and Pro-entitlement resolution;
- folder, file, trash and storage queries;
- upload, rename, move, restore and delete mutations;
- optimistic cache behaviour and upload compensation;
- recursive search and export workflows;
- Google Drive integration;
- more than 40 pieces of local UI state;
- the majority of the page rendering and dialogs.

## Safety position

The existing test estate is sufficient for careful, bounded extraction. It is
not permission to redesign Vault or change its database contracts.

The focused starting baseline passed **82/82 tests across seven files**:

- `VaultPage.characterization.test.tsx`: 13 permission, scope and mutation cases;
- `vaultUpload.test.ts`: 8 quota, storage and compensation cases;
- `vaultDelete.test.ts`: 5 bounded deletion-batch cases;
- `vaultTrashOutcome.test.ts`: 5 accurate outcome-reporting cases;
- `galleryVaultSync.test.ts`: 9 gallery-to-Vault isolation cases;
- `VaultStorageBarRow.test.tsx`: 4 accessibility and interaction cases;
- `vaultMutationSafety.security.test.ts`: 38 server-boundary contracts.

Additional established protection includes local-Supabase RLS and mutation
integration tests plus the Playwright Vault upload journey. Database tests must
continue to use only the isolated local stack and synthetic data.

## Non-negotiable behavioural boundaries

Every slice must preserve:

1. Fail-closed role and Pro-entitlement decisions.
2. Exact club, team, mini-league and folder isolation.
3. Restricted chat-folder visibility rules.
4. Exclusion of soft-deleted folders, files and teams from active selectors.
5. Upload quota reservation before storage writes, and compensation after any
   metadata failure.
6. Optimistic deletion rollback and truthful partial-failure reporting.
7. Permanent deletion only through the authorized server boundary.
8. Exact cache invalidation and gallery/Vault synchronization behaviour.
9. Deep-link, pinned-chat and browser-history navigation behaviour.
10. Recursive search/export scope and cancellation behaviour.
11. Current desktop, mobile and keyboard-accessible interactions.
12. Existing Google Drive allowlisting and authorization boundaries.

## Staged implementation

### V1 — Stable types and pure scope rules

- Move `FolderView` and related domain types into `src/features/vault/types.ts`.
- Extract pure helpers for current club/team/folder scope, hierarchy labels,
  query-scope construction and role-folder visibility.
- Add direct unit tests for these helpers, including cross-club and deleted
  entity cases.
- Keep `VaultPage` as the caller and preserve its rendered output.

This is the safest first slice because it introduces no new side effects and
does not move Supabase ownership.

**Completed 7 August 2026:**

- Added typed Vault view and scope contracts under `src/features/vault`.
- Extracted exact club/team/mini-league/folder scope resolution, club-role
  collection, restricted-folder visibility and organisation abbreviation.
- Added ten direct boundary tests, including fail-closed missing context and
  cross-club role isolation.
- Rewired `VaultPage` without moving any Supabase query, mutation or UI state.
- Focused verification passes 92/92 tests across eight files.
- Targeted lint is clean for all new files. The legacy page still reports its
  existing broad `any`, hook-dependency and `prefer-const` debt; that debt was
  not mixed into this behaviour-preserving slice.

### V2 — Access and entitlement boundary

- Extract role, club/team membership and Pro access reads behind a dedicated
  Vault access hook/repository.
- Return a small typed access model rather than exposing raw query rows.
- Preserve fail-closed loading and error behaviour.
- Run characterization, entitlement and membership suites.

**V2a completed locally 7 August 2026:**

- Extracted pure role access, current-club privilege, coach/team-admin
  visibility, upgrade routing, team-scope collection, Pro flag resolution,
  context inheritance and final Vault-access decisions.
- Added 14 permission-matrix cases covering cross-club isolation, missing-role
  fail-closed behaviour, app-admin handling, all supported Pro flags, team Pro
  inheritance and root-versus-inner context.
- Kept every Supabase read and its query key/loading behaviour in `VaultPage`;
  moving those reads is the separate V2b slice.
- Focused verification passes 106/106 tests across nine files. New access files
  pass targeted lint.
- The first verification run exposed a refactoring-only missing derived value
  used by the denied-access UI. It was restored before completion; the full
  focused suite then passed.

**V2b completed locally 7 August 2026:**

- Moved app-admin, user-role, accessible-club, current club/team entitlement
  and any-Pro reads into a typed feature repository.
- Kept React Query keys, enablement, loading aggregation and UI decisions in
  `VaultPage`.
- Added nine repository-contract cases for exact identifiers, direct and
  team-derived club scope, query short-circuiting, supported entitlement
  sources, the legacy club fallback and empty-scope fail-closed behaviour.
- Focused verification passes 115/115 tests across ten files.

### V3 — Read-model boundary

- Extract folder, file, recursive-search, trash and storage reads into focused
  repository functions and query hooks.
- Keep query keys and invalidation contracts stable.
- Separate data mapping from rendering without introducing a generic global
  data layer.
- Verify exact scope filters and stale/deleted-row exclusion.

**V3a completed locally 7 August 2026:**

- Extracted the active-folder read into the typed Vault read repository.
- Preserved React Query ownership and its existing key/enablement in the page.
- Added six direct contracts for root and mini-league no-query behaviour,
  role-less fail-closed access, exact club/team/parent/deleted filters, coach
  chat-folder restriction and privileged visibility.
- Focused verification passes 121/121 tests across eleven files.
- File content, recursive search, trash and storage reads remain deliberately
  page-owned for later V3 slices.

**V3b completed locally 7 August 2026:**

- Extracted the active `vault_files` read and pure photo/document partitioning.
- Preserved active-row filtering, descending creation order, exact club/team/
  mini-league/folder scope and the coach club-root loose-file restriction.
- Added seven active-item contracts (13 total in the read-repository suite),
  including MIME/extension classification and compatibility-field mapping.
- A first test assumed image URLs were inspected when a non-extension filename
  existed. Existing behaviour gives the filename precedence; the test was
  corrected to characterize that behaviour rather than changing production.
- Focused verification passes 128/128 tests across eleven files.

**V3c completed locally 7 August 2026:**

- Extracted the recursive folder-tree read and pure visibility/path builder.
- Added six contracts for nested paths, subtree starts, restricted-parent
  isolation, unsupported-context no-query behaviour and exact club/team scope.
- Preserved the existing traversal order and the rule that a visible generic
  child cannot be reached through a hidden restricted parent.
- Focused verification passes 134/134 tests across eleven files.
- The debounced recursive file search remains page-owned for V3d.

**V3d completed locally 7 August 2026:**

- Extracted the recursive file search and folder/file result mapping.
- Preserved escaped `ilike` matching, the 200-row bound, newest-first order,
  exact club/team/mini-league scope and selected-folder descendant constraint.
- Preserved root-file inclusion, hidden-folder exclusion, selected-folder
  inclusion and cached path mapping.
- Reused the characterized image classifier for recursive result partitioning.
- Added six search contracts; focused verification passes 140/140 tests across
  eleven files.

**V3e completed locally 7 August 2026:**

- Extracted the club-wide trash read and reused the characterized photo/file
  partitioning boundary.
- Preserved deleted-only filtering, newest-deleted ordering, folder/team label
  joins and club scope when trash is opened from team or mini-league context.
- Added four contracts for root no-query, club-wide scope, joined metadata and
  compatibility mapping.
- Focused verification passes 144/144 tests across eleven files.
- Restore, permanent-delete and empty-trash mutations remain page-owned for V4.

**V3f completed locally 7 August 2026:**

- Extracted purchased-storage retrieval and storage-breakdown accounting into a
  dedicated typed repository.
- Preserved exact club scope, active photo/file/team filtering, mini-league
  attribution, filename-only image classification, descending scope totals and
  the legacy 500KB fallback for absent or zero photo size.
- Added seven contracts for accounting, labels/order, subscription defaults and
  repository filters.
- Focused verification passes 151/151 tests across twelve files.
- The page continues to own React Query policy, warning thresholds, plan limits
  and all storage presentation.

### V4 — Mutation boundary

- Extract folder/file rename and move, soft delete, restore, permanent delete
  and bulk operations into focused services/hooks.
- Retain server-authoritative permission enforcement.
- Preserve optimistic cache rollback, upload compensation and partial failure
  reporting.
- Do not combine database-contract changes with this extraction.

**V4a completed locally 7 August 2026:**

- Extracted folder rename, file/photo rename and file move writes into a typed
  mutation repository.
- Preserved exact table/ID/payload contracts, including the distinction between
  omitted `targetTeamId` (retain scope) and explicit `null` (clear scope).
- Kept React Query lifecycle callbacks, path state, dialogs, invalidation and
  toasts in `VaultPage`.
- Added five mutation contracts including original permission-error
  propagation; focused verification passes 156/156 tests across thirteen files.

**V4b completed locally 7 August 2026:**

- Extracted folder creation/deletion and single-item soft-delete/restore writes
  into the typed mutation repository.
- Preserved exact creator, parent, club/team scope, row ID, deletion actor and
  timestamp payloads. Folder creation deliberately retains the existing rule
  that only club and team views add scope fields.
- Kept dialogs, optimistic cache rollback, invalidation, UI state and toasts in
  `VaultPage`.
- Added seven lifecycle contracts, including exact-row targeting, restoration
  field clearing and original error propagation; focused verification passes
  163/163 tests across thirteen files.
- Permanent deletion, bulk deletion, empty-trash and upload workflows remain
  page-owned for later V4/V5 slices.

**V4c completed locally 7 August 2026:**

- Extracted single-photo and single-file permanent deletion into the typed
  mutation repository while retaining the authorized Edge Function boundary.
- Preserved the legacy photo mirror lookup by exact `file_url`, exact Vault row
  targeting, deletion type, cache invalidation and page-owned success/error UI.
- Added five contracts covering mirror resolution, missing mirrors, missing
  URLs, file-only deletion and Edge Function failure propagation.
- Focused verification passes 168/168 tests across thirteen files.
- Batch soft-delete and empty-trash orchestration remain page-owned for the
  separate partial-success V4d slice.

**V4d completed locally 7 August 2026:**

- Extracted sequential bulk soft-delete and empty-trash preparation into a
  focused service without changing the existing server deletion contract.
- Preserved photo-before-file processing, continuation after individual
  failures, exact successful IDs, legacy photo-mirror lookup and bounded Edge
  Function batching through the existing permanent-delete service.
- Kept photo-cache cleanup, failure logging, invalidation, selection/loading
  state and truthful single-toast outcomes in `VaultPage`.
- Added six contracts for complete success, partial failure, empty selection,
  mirror mapping, missing mirrors/URLs and unchanged server failure results.
- Focused verification passes 174/174 tests across fourteen files.

### V5 — Upload and external-link workflows

- Move upload orchestration, URL/link creation and Drive title/import handling
  out of the page.
- Keep quota reservation and orphan cleanup mandatory.
- Preserve the existing Google Drive feature allowlist until a separately
  reviewed product decision replaces it.

**V5a completed locally 8 August 2026:**

- Extracted the duplicated club/team/mini-league upload scope and storage-path
  construction into typed, deterministic helpers.
- Extracted external-link metadata insertion while preserving uploader,
  folder, zero-byte and exact scope fields.
- Reused the characterized helpers in photo and file uploads without moving or
  reordering quota reservation, storage upload, orphan compensation, metadata
  insertion or reservation settlement.
- Added six contracts for every supported scope/path, external-link ownership,
  absent cross-scope fields and permission-error propagation.
- Focused verification passes 180/180 tests across fifteen files.
- Full upload orchestration and Google Drive workflows remain page-owned for
  later V5 slices.

**V5b completed locally 8 August 2026:**

- Extracted the shared photo/file upload transaction into the typed upload
  service while keeping page-owned names, dialogs, invalidation and toasts.
- Preserved and directly tested the critical order: reserve quota, upload
  bytes, write metadata, then commit the reservation.
- Preserved failure compensation: storage failure releases the reservation
  without metadata writes; metadata failure removes the orphan before releasing
  quota; reservation failure prevents all storage activity.
- Preserved photo-only MIME metadata, custom file names, canonical bucket/path
  metadata and every scope field.
- Added five transaction contracts (eleven upload-service tests total) and
  relocated three source-level security assertions to the extracted boundary.
- Focused verification passes 185/185 tests across fifteen files.
- Google Drive title/import/link workflows remain page-owned for V5c.

**V5c completed locally 8 August 2026:**

- Extracted the established three-club Google Drive rollout allowlist into an
  explicit fail-closed feature boundary.
- Extracted Drive title resolution into a typed service that sends only the
  selected club ID to the existing Edge Function.
- Kept platform exclusion, admin checks, loading state, summary/toast wording,
  error presentation and query invalidation in `VaultPage`.
- Added five contracts for the exact allowlist, absent/unknown clubs, request
  payload, absent summaries and Edge Function failures.
- Focused verification passes 190/190 tests across sixteen files.
- OAuth return handling and the self-contained import/link dialogs remain for
  later V5 slices; their behavior was not changed here.

**V5d completed locally 8 August 2026:**

- Extracted native/web redirect URI selection, OAuth code exchange and token
  routing into the typed Drive service.
- Preserved exact session-storage keys and the established rule that a pending
  folder-link takes precedence over an import, while React dialog state,
  logging, user-facing errors and pending-flow cleanup remain page-owned.
- Hardened a malformed successful response with no access token to fail closed
  rather than opening a dialog with an unusable token.
- Added five OAuth contracts (ten Drive-service tests total) for redirect URIs,
  exact exchange payloads, all failure forms, link precedence and distinct
  import token keys.
- Focused Vault verification passes 195/195 tests across sixteen files; the
  related routing/cache safety set also passes 91/91 tests.
- The import and folder-link dialogs are already self-contained components and
  are not candidates for deeper extraction unless defects or tests justify it.

### V6 — Selection and export workflows

- Extract selection state, recursive folder collection, export preview,
  cancellation and large-file management.
- Add focused coverage for recursion, excluded folders, aborts and partial
  download failure before moving side-effectful code.

**V6a completed locally 8 August 2026:**

- Extracted current-folder export reads and depth-first recursive collection
  into a typed repository.
- Preserved exact team versus club-level filters, deleted-folder exclusion,
  folder/parent targeting, item paths, traversal order and a shared truthful
  folder breakdown.
- Added five contracts for team scope, club-root isolation, path mapping,
  recursive traversal and the existing root behavior.
- Focused verification passes 200/200 tests across seventeen files.
- Two pre-existing behaviors were characterized rather than silently changed:
  recursive export still reads legacy `photos`, and root export has no club or
  team filter and therefore relies on RLS. Both require separate product/
  defect review before alteration.
- ZIP creation, cancellation, partial download handling, selection/exclusion
  rules and large-file management remain page-owned for later V6 slices.

**V6b completed locally 8 August 2026:**

- Extracted immutable item toggling, select-all, selected-item resolution,
  recursive-preview exclusions and confirmation-count rules into a pure typed
  boundary.
- Reused the same rules for page-level and folder-dialog selection without
  moving ZIP creation, downloads, cancellation, state ownership or user-facing
  behavior.
- Added seven contracts for independent photo/file selection, display-order
  preservation, duplicate IDs, current-folder path normalization, folder
  exclusion and selection-versus-current-view summaries.
- Focused Vault verification passes 208/208 tests across eighteen files; the
  new boundary passes targeted lint and the production build succeeds.
- ZIP orchestration, cancellation/partial-download handling and large-file
  management remain page-owned for later V6 slices.

**V6c completed locally 8 August 2026:**

- Extracted the duplicated recursive-preview and current-view ZIP assembly into
  a typed service while retaining page-owned dialogs, toasts, filenames and
  browser download activation.
- Preserved sequential photo-before-file downloading, nested paths, fallback
  photo filenames, successful-item progress and continuation after individual
  download failures.
- Made cancellation a stable service contract before, during and after item
  download/ZIP generation, and retained the established no-empty-ZIP behavior
  when every item fails.
- Added six contracts for ordering/paths, fallback names, partial failure,
  all-item failure and cancellation. Focused Vault verification passes 214/214
  tests across nineteen files; new boundaries pass lint and production build.
- The folder-dialog ZIP path intentionally remains separate because it reports
  attempted items rather than successful items. Large-file management and that
  legacy reporting decision remain for later review.

**V6d completed locally 8 August 2026:**

- Extracted large-file photo/file mapping, club/team labels, top-50 limiting,
  immutable size/date/type sorting and exact deletion preparation into a typed
  pure boundary.
- Preserved existing Supabase reads, permanent-delete Edge Function ownership,
  query invalidation, dialogs and user-facing outcomes in `VaultPage`.
- Added six contracts for mapping/fallback labels, limiting, all three sort
  modes, non-mutating rendering, exact photo/file IDs and selected-byte totals.
- Focused Vault verification passes 220/220 tests across twenty files.
- Review exposed two pre-existing truthful-reporting defects: folder ZIP
  success counted attempted downloads, and large-file deletion reported all
  selected rows/bytes as deleted when the server returned failures. Both were
  subsequently fixed on `main`, merged back into the tranche and protected by
  focused complete/partial/failure/cancellation contracts.
- The follow-up contract hardening now retains and validates the Edge
  Function's explicit `succeeded[]` identifiers across batches. Only validated
  item-level acknowledgements count toward deleted rows, selection clearing or
  freed bytes; unknown, duplicated, mismatched and contradictory results fail
  closed under direct tests.

### V7 — Presentation decomposition

- Split navigation/header, content sections, trash, storage management and
  dialogs into typed presentation components.
- Components receive explicit data and callbacks and must not independently
  acquire broader database access.
- Preserve mobile layout, focus management and keyboard behaviour.

**V7a completed locally 9 August 2026:**

- Extracted recursive-export preview and export-confirmation rendering into a
  typed, database-free component while leaving state, permissions, scanning,
  ZIP orchestration and callbacks in `VaultPage`.
- Preserved loading, filtered counts, folder inclusion toggles, zero-item
  disabling, selection/current-folder/recursive wording and cancel/confirm
  behavior.
- Added five interaction and accessibility contracts, including an explicit
  accessible description for the recursive preview dialog.
- Focused Vault verification passes 253/253 tests across twenty-two files.

**V7b completed locally 9 August 2026:**

- Extracted the large-file manager dialog into a typed, database-free
  presentation component while retaining reads, deletion, selection state,
  query invalidation and permission ownership in `VaultPage`.
- Preserved loading/empty states, immutable size/date/type ordering, selected
  byte totals, row and checkbox interaction, retry selection and delete loading.
- Added six interaction and accessibility contracts, including close delegation
  so the page remains responsible for clearing selection.
- Focused Vault verification passes 259/259 tests across twenty-three files;
  extracted components pass lint and the production build succeeds.

**V7c completed locally 9 August 2026:**

- Extracted folder export selection into a typed, database-free presentation
  component while retaining folder reads, selected-item state and truthful ZIP
  execution in `VaultPage`.
- Preserved loading/empty states, photo/file sections, select/deselect-all,
  selected counts, item toggles, zero-selection disabling and close cleanup.
- Prevented checkbox clicks from bubbling to the row and toggling an item twice,
  matching the intended single selection action.
- Added six interaction and accessibility contracts. Focused Vault verification
  passes 265/265 tests across twenty-four files; extracted components pass lint
  and the production build succeeds.

**V7d completed locally 9 August 2026:**

- Extracted the compact storage summary, team usage, photo/document chart,
  club team breakdown and storage-management controls into a typed,
  database-free presentation component.
- Retained storage queries, entitlement and permission decisions, the 80%
  management threshold, export/trash actions and all callbacks in `VaultPage`.
- Preserved the existing compact/expanded layout and delegated large-file and
  storage-purchase actions through explicit callbacks.
- Added six rendering, interaction and ownership-boundary contracts. Focused
  Vault verification passes 271/271 tests across twenty-five files.

**V7e completed locally 9 August 2026:**

- Extracted photo/file deletion, restore, bulk deletion and folder deletion
  confirmation rendering into a typed, database-free component.
- Retained soft-versus-permanent mutation selection, item identifiers, mutation
  execution and dialog state ownership in `VaultPage`.
- Preserved destructive wording, restore routing, singular/plural counts,
  in-flight control locking and the folder move-to-parent warning.
- Added six focused interaction contracts. Focused Vault verification passes
  277/277 tests across twenty-six files.

**V7f completed locally 9 August 2026:**

- Extracted folder, file and photo rename dialogs into a typed, database-free
  component while retaining item identifiers, input state and mutation
  execution in `VaultPage`.
- Preserved item-specific labels/placeholders, trim-based validation, close
  cleanup and callback behavior.
- Added a visually hidden accessible description to resolve the pre-existing
  dialog warning without changing visible behavior.
- Added five focused rendering, validation and delegation contracts. Focused
  Vault verification passes 282/282 tests across twenty-seven files.

**V7g completed locally 9 August 2026:**

- Moved the signed-photo tile renderer into a dedicated typed presentation
  component while leaving permission decisions, selection state, lightbox
  routing and action callbacks with the page/content owner.
- Preserved private signed-URL loading, hidden preload behavior, stable empty
  and failure states, selection-mode isolation and download/rename/delete menus.
- Added six focused loading, fallback, selection, routing and action contracts.
  Focused Vault verification passes 288/288 tests across twenty-eight files.

### V8 — Closeout

- Run all focused Vault suites after each slice.
- Run the complete one-click baseline before declaring the tranche complete.
- Perform manual Android and iOS checks for upload, folder navigation, trash,
  download/export and return-from-chat navigation.
- Record final line-count reduction, remaining specialist risks and vendor
  handover score.

**V8 automated closeout completed locally 9 August 2026:**

- The expanded focused Vault baseline passes 334/334 tests across thirty-one
  files, covering access and scope isolation, repositories, uploads, Drive,
  exports, truthful mutation reporting, storage accounting, chat/Vault sync,
  presentation dialogs and page characterization.
- The V7g photo presentation boundary and its tests pass targeted lint, and the
  production Vite build succeeds.
- `VaultPage.tsx` is 4,019 lines, down from the 5,734-line starting point: a
  reduction of 1,715 lines (29.9%) while retaining page-level workflow and
  permission ownership.
- Whole-page lint still reports legacy debt (70 explicit-`any` errors and 11
  hook-dependency warnings). This predates V7g and is deliberately not folded
  into presentation refactoring; it should be handled as separately tested,
  behaviour-preserving maintenance work.
- Automated closeout does not replace the planned manual Android/iOS checks for
  upload, folder navigation, trash, download/export and return-from-chat
  navigation. The complete one-click baseline and those device checks remain
  required before merging the Vault tranche to `main`.

## Commit and rollback strategy

- One reviewable commit per slice; do not mix unrelated fixes.
- Tag defects discovered by tests as pre-existing and fix them separately.
- Keep `c83bab566` and `verify/messaging-10-complete` as the pre-Vault recovery
  point.
- Create a `verify/vault-<slice>` branch after each green tranche that is worth
  UI review.
- Do not merge the Vault tranche to `main` until automated and selected manual
  checks pass.

## Stop conditions

Pause the slice if it requires a schema/RLS change, changes visible behaviour,
weakens a permission check, alters storage paths, expands Drive access, or
cannot be protected by a deterministic test. Such work must become a separate
defect or product change, not be hidden inside refactoring.

Stop general Vault refactoring once page ownership is primarily composition and
the remaining complexity reflects real UI workflows. The goal is maintainable
boundaries, not the smallest possible page.
