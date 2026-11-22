# DEV release-safety inventory correction — 22 November 2026

## Diagnosis

The complete migration inventory listed 55 files, but DEV source contained 60.
All 55 existing filenames and SHA-256 fingerprints still matched; no originals
were removed or edited. Five later DEV migrations were absent from the manifest.
The reported four safe-apply failures reproduce locally, along with two sibling
safe-staging failures, with the same complete-inventory refusal. With the workflow's
pinned pglast 7.22 installed, the original source checks had 47 passes and 6 failures.

## Correction

Added the five missing files to the ordered, fingerprinted inventory as **hold**:

- `20261116085314_683fa371-acd8-47b9-b075-dfb0ab364037.sql`: dynamic invitation helper rewrites.
- `20261116085410_2513732e-4dfa-47f6-95c3-2286246d2fbf.sql`: invitation refusal helper and execution-boundary change.
- `20261116085524_4b841888-bc21-4ad7-a0a7-46a281a453f5.sql`: dynamic invitation claimant lifecycle rewrites.
- `20261116085655_e85f1309-b328-4abb-a5d8-08714960627e.sql`: DEV test invitation inserts, forbidden on PROD.
- `20261121225522_160f9101-5bfe-46cc-9f5d-f8de60ed0cac.sql`: onboarding repair pinned to the DEV database system identifier.

The corrected manifest has **60 originals, 16 candidates and 44 held files**.
Existing eleven execution approvals, reviewed findings, protected source policy,
migration bytes, release runner and workflow remain unchanged. Only stale held-count
expectations were updated; five regressions ensure each added migration remains
fingerprinted and cannot be selected even by an attempted approval while held.

## Local production source-check rerun

Executed the exact commands from the `source-tests` job in `[DB] Promote to Prod`:

1. Structural release, safe staging, safe apply and diagnostic suites:
   **58 passed, 0 failed, 0 skipped**.
2. Exact approved signup and competition upload preflight rehearsals:
   **6 passed, 0 failed, 0 skipped**. Real PostgreSQL checks use disposable,
   credential-free, socket-only clusters; orchestration checks substitute local
   fake clients and never reach hosted databases.
3. Complete source-staging command: **passed**, 60 originals / 16 candidates /
   44 held; `deploymentAuthorized: false`.
4. Additional auth-release preflight and production no-data protection suites:
   **17 passed, 0 failed, 0 skipped**.

## Release limitations

This resolves the source-inventory mismatch, not PROD target readiness or the
outstanding onboarding rollout. Held onboarding SQL still needs a separately
reviewed PROD-specific structural release and exact target/dependency acceptance.
No production workflow was dispatched or rerun: the production push workflow can
deploy after source tests, so its commands were exercised locally instead.
No database, migration history, credentials, scheduler, hosting, canister or native
application deployment was changed; no PROD network operation was performed.