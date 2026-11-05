# Website source-error repair — 5 November 2026

## Scope

Fixed the reserved `new` parameter in `merge_principal` and `rekey_principal` TypeScript interfaces. Both `frontend/src/lab/bindings` and `frontend/src/lab/generated-contracts` had 16 affected signatures across ten files each. The change is only a TypeScript parameter label (`new_principal`); method names, argument order, types, Candid declarations, backend code, mappings and production data remain unchanged.

Added `frontend/scripts/generated-contract-syntax.test.mjs` to repository source CI. It checks every TypeScript file in both generated trees. Existing backend instructions already require normalizing reserved Candid parameter labels in copied generator inputs.

## Verification

- Before repair, each generated tree produced 32 syntax-parser diagnostics; the new regression test failed for both trees. These are the locally reproduced cause of the reported 68 hosted diagnostics, not a claim to have rerun the hosted compiler.
- After repair, all three syntax regression tests pass, with zero parser diagnostics across both trees.
- Topology valid; Candid method drift passes for 17 active contracts.
- Source CI's scoped lint passes; localRuntimeMode and disabledLabRuntime tests pass (3 tests, 2 files).
- Latest available preview build log: build OK.
- Approved release/environment/publication tests rerun: 97 total, 96 pass, 1 fails. The same pre-existing `workflow-env-names.test.mjs` PROD workflow classification assertion failed before this repair (the policy-only group was 27/28). No release gate was weakened.
- Exact competition SQL rehearsal: 24 pass. Invitation/welcome SQL rehearsal: 12 pass. Both use credential-free socket-only local PostgreSQL clusters.

## Hosted result and release verdict

The last GitHub read still showed main commit `3dbd6f10fbaeab97eaae0ebf74b845d0d3fba4be` and failed source-check run `41940832113`, and remote generated code still had `new`. The corrected workspace files had not yet reached that remote branch at that read. Rerunning that old run would test old bytes, so it was not requested. The repaired commit's normal main-push source check must finish before claiming the full product typecheck is green; no manual local build or project typecheck was run.

**Do not merge yet.** The separate release-policy failure and profile-country compatibility task remain open, along with the previously recorded hosted evidence limitations. This task did not alter permissions, production deployment, data, approval files or the PROD pull-request hold.