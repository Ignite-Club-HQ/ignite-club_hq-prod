# Ignite Club HQ — Vault Refactoring Plan

**Established:** 7 August 2026  
**Development branch:** `codespaces-review`  
**Starting checkpoint:** `c83bab566`  
**Status:** V1–V3e committed; V3f storage reporting complete locally; review/commit pending

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

### V5 — Upload and external-link workflows

- Move upload orchestration, URL/link creation and Drive title/import handling
  out of the page.
- Keep quota reservation and orphan cleanup mandatory.
- Preserve the existing Google Drive feature allowlist until a separately
  reviewed product decision replaces it.

### V6 — Selection and export workflows

- Extract selection state, recursive folder collection, export preview,
  cancellation and large-file management.
- Add focused coverage for recursion, excluded folders, aborts and partial
  download failure before moving side-effectful code.

### V7 — Presentation decomposition

- Split navigation/header, content sections, trash, storage management and
  dialogs into typed presentation components.
- Components receive explicit data and callbacks and must not independently
  acquire broader database access.
- Preserve mobile layout, focus management and keyboard behaviour.

### V8 — Closeout

- Run all focused Vault suites after each slice.
- Run the complete one-click baseline before declaring the tranche complete.
- Perform manual Android and iOS checks for upload, folder navigation, trash,
  download/export and return-from-chat navigation.
- Record final line-count reduction, remaining specialist risks and vendor
  handover score.

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
