# Promotion and Rollback Runbook

**Status:** Authoritative repository promotion policy
**Last reviewed:** 2026-08-13

This document defines how changes move between branches. It does not grant
permission to operate production. Production access remains restricted to
authorized maintainers following the reviewed GitHub workflow.

## Branch roles

| Branch | Role | Production effect |
| --- | --- | --- |
| `main` | Primary development line, including Lovable-authored fixes | Frontend CI; no intended Supabase production mutation |
| `codespaces-review` | Full isolated integration and baseline validation | Local Docker Supabase only |
| `prod` | Release/deployment trigger | Production Supabase and downstream release workflows |
| `verify/*`, `refactor/*`, `integrate/*` | Temporary tranche construction/review | None unless deliberately promoted |

Branch protection and required checks are configured outside the repository and
must be verified in GitHub. Branch names alone are not a safety boundary.

## Production workflow event isolation

`.github/workflows/promote-to-prod.yml` has two explicitly separated paths:

- pull requests targeting `prod` run file-only destructive-migration analysis
  and report changed migration/Edge Function paths; that job has no production
  secrets, Supabase CLI, database connection, migration, or deployment;
- the production job is gated against pull-request events and additionally
  requires the checked-out ref to be `prod` before secrets are loaded.

The production job remains a privileged operation. Require an authorized
release operator, reviewed release window, green validation, and rollback point
before merging or manually dispatching it from `prod`.

## Standard change path

1. Make and review the change on `main` (or merge a focused PR to `main`).
2. Merge/fast-forward the tested `main` state into `codespaces-review`.
3. Confirm the `Complete isolated baseline` GitHub Action is green for the exact
   commit. It runs frontend tests, Playwright, local Supabase tests, cleanup, and
   the destructive-migration guard.
4. Perform the manual checks appropriate to the risk: role matrix, native
   lifecycle/deep links, payments, push delivery, accessibility, and changed
   third-party integrations.
5. Record the release commit, evidence, migration list, changed Edge Functions,
   operator, and rollback point.
6. Only an authorized operator should promote the approved commit to `prod`.
7. Observe the production workflow to completion, then perform post-release
   smoke checks and monitoring.

## Codespaces-authored refactor path

Do not merge a long-running cumulative integration branch directly into `main`
or `prod`.

1. Keep each feature refactor as a separately identifiable tranche with focused
   tests and commits.
2. Test it on a `verify/*` or `integrate/*` branch based on the intended
   cumulative state.
3. Complete manual UI/native verification before promotion.
4. Create a fresh promotion branch from the latest `main`.
5. Cherry-pick or otherwise apply only that reviewed tranche; resolve conflicts
   by preserving current `main` fixes and the tranche's tested boundary.
6. Run focused tests, then validate the resulting exact commit through
   `codespaces-review` and the complete baseline.
7. Merge the promotion branch to `main`. Promote to `prod` only through the
   standard change path above.

This preserves a clean rollback unit and prevents unrelated cumulative work from
quietly entering production.

## Local validation

Fast checks:

```bash
npm run typecheck:production
npm run typecheck:strict-features
npm run build
npm run test:run
```

Complete baseline:

```bash
npm run test:baseline
```

The complete runner accepts only the isolated localhost Supabase workspace. It
must never receive hosted URLs, project references, database passwords, access
tokens, service-role keys, or real club/user data. See
[Local Supabase security tests](testing/local-supabase.md).

The GitHub complete-baseline workflow intentionally runs only when the checked
out branch is `codespaces-review`. Do not weaken that guard for convenience.

## Database and Edge Function changes

- Review every new migration as executable production code.
- Keep migrations forward-only, bounded, and safe for existing data.
- The destructive-migration guard must pass; an exception requires explicit
  evidence, backup/restore planning, and release-owner approval.
- Verify production schema backup artifacts before applying migrations.
- Deploy only the functions represented by the reviewed commit/workflow logic.
- Never run linked Supabase commands from the local test workflow.
- Local synthetic schema parity tests increase confidence but do not prove the
  hosted schema or external dashboard configuration is identical.

The detailed environment checklist is in
[Dev to Prod Promotion Checklist](PROMOTION_CHECKLIST.md).

## Stop conditions

Stop promotion if any of the following is true:

- the exact release commit did not pass the required baseline;
- the branch contains unrelated or cumulative unreviewed changes;
- migration content or changed Edge Functions differ from the approved list;
- a required secret, backup, reviewer, or rollback point is missing;
- tests require hosted database credentials or real data;
- a production workflow step behaves differently from the reviewed plan;
- manual native/payment/push checks required by the change are incomplete.

## Rollback

### Frontend-only change

Revert the smallest promotion commit, validate the revert, and promote the new
known-good commit. Do not rewrite shared branch history.

### Database change

Do not assume a Git revert reverses data. Assess compatibility first. Prefer a
forward repair migration. Use the production backup/restore procedure only with
authorized operational approval and an understood recovery point/objective.

### Edge Function change

Redeploy the last known-good function revision through the controlled production
workflow. Confirm its schema expectations remain compatible.

### Mobile release

Use the relevant store rollback/halt mechanism and ship a tested corrective
build. Web rollback does not replace a native-store response.

After rollback, record impact, timestamps, affected commit/function/migration,
recovery evidence, and follow-up tests.

## Release evidence template

```text
Release commit:
Source tranche(s):
Baseline run URL/result:
Focused tests:
Manual checks:
Migrations reviewed:
Edge Functions reviewed:
Known-good rollback commit:
Backup artifact/status:
Operator and reviewer:
Post-release checks:
```
