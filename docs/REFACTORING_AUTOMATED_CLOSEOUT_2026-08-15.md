# Refactoring automated closeout

**Date:** 15 August 2026

**Branch:** `integrate/competition-current`

**Historical verified commit:** `6d691b52ddad7d266571fdba2058b39072c51f74`

**Status:** Superseded by the current
[`RELEASE_CANDIDATE_2026-08-17.md`](RELEASE_CANDIDATE_2026-08-17.md); delegated
manual acceptance and promotion remain pending

## Decision

> This document records the 15 August checkpoint. Use the current release
> candidate and promotion-tranche documents for present evidence and next
> actions.

The planned Competition, Messaging, Membership/Invitations, Vault, AutoSub and
PitchBoard, Events, Home/data-boundary, and Media refactoring tranches are
technically complete on the cumulative integration branch. General structural
extraction stops at this checkpoint. Large files that remain are not, by
themselves, justification for more refactoring.

This checkpoint is not merged to `main` or `prod`. It is a review candidate,
not a production release.

## Automated evidence

The complete isolated baseline passed on 14 August 2026 against the cumulative
branch immediately before the final PlayHQ correction:

- frontend Vitest: 506 files, 5,215 passed and 3 intentional skips;
- isolated Playwright: 139/139 passed;
- local Supabase integration: 32 files, 258/258 passed;
- synthetic local migration ledger: all 24 migrations applied;
- local Supabase cleanup: passed with no allowlisted containers or volumes left;
- total passing tests: 5,612;
- TypeScript: passed;
- production Vite build: passed.

The final PlayHQ correction at `6d691b52d` then passed:

- the new loading-to-configured and loading-to-unconfigured regression tests;
- the wider Team Detail access and role suites (34 focused tests total);
- TypeScript;
- targeted ESLint with zero findings;
- `git diff --check`.

No hosted Supabase project, hosted development environment, production
environment, or real club/user data was used by these checks.

## What changed structurally

- Business policies and payload decisions moved into typed feature modules.
- High-risk multi-step operations gained explicit workflow and completion
  boundaries.
- Supabase reads and writes were moved incrementally into feature repositories,
  particularly for Competition, Messaging, Vault, Events, Home, Membership and
  Media.
- Canonical query keys and cache-completion rules now protect tenant and entity
  scope.
- Realtime, resume/reconnect and notification navigation gained explicit,
  tested lifecycle boundaries.
- Large pages remain route-level composition owners where further extraction
  would add more risk than practical maintainability benefit.

## Known debt intentionally retained

- Repository-wide ESLint is not yet a green gate. Most reported errors are
  legacy `no-explicit-any` findings; hook-dependency warnings also remain.
- Several route controllers remain large, especially Vault, Event Detail,
  PitchBoard, AutoSub, Team/Club Detail, Home and Messaging.
- The production build contains large chunks and mixed static/dynamic imports.
  Optimise these only against measured user performance.
- Native behavior, real push delivery, payments and third-party console state
  cannot be fully proven by the isolated baseline.
- Historical plan text records the evidence available at each tranche; this
  closeout supersedes stale top-level “pending commit/baseline” status lines.

## Promotion rule

Do not merge this long-running cumulative branch directly into `main` or
`prod`. Follow `docs/PROMOTION.md`:

1. complete the delegated manual checklist;
2. record the reviewer and evidence against this exact commit;
3. create a fresh promotion branch from current `main`;
4. apply only reviewed tranches while preserving later `main` fixes;
5. rerun focused tests and the complete baseline on the exact candidate;
6. merge only after explicit approval and a documented rollback point.

## Next action

Delegate [the refactoring manual acceptance checklist](testing/REFACTORING_MANUAL_ACCEPTANCE.md).
Until it is completed, keep the integration branch as a recoverable automated
checkpoint and leave `main` and `prod` unchanged.
