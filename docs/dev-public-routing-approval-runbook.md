# DEV public-routing approval — read-only governor verification

DEV is the `main` branch with `deploy/mainnet` canisters on the ICP public mainnet; PROD is the separate `prod` branch with `deploy/prod` canisters. Do not mix router IDs, governor keys, approvals or snapshots.

## Current blocker
The DEV router `jcdfe-vqaaa-aaaal-qxloq-cai` reports `read_routing_approval("mainnet") = Ok(null)`, and `read_public_group_targets` refuses with `Public group configuration awaits approval`. Authenticated Test2 creator placement into Group 2 works, but public routing is not yet approved.

## Phase 1 — verify only
On GitHub Actions, run **[TEST] Verify DEV public routing (read-only)** on branch `main`. Its protected `group-2-admin-controls` environment uses the existing pinned DEV governor and push worker. It sets `SNAPSHOT_CHECK_ONLY=1` and `RECORD_ROUTING_APPROVAL=0`. It cannot upgrade canisters, change group settings, publish a website, write a router approval or modify the frontend routing snapshot.

Inspect the run and `dev-public-routing-evidence` artifact. The governor-signed live check verifies the registered group inventory, placement, per-service controller, certified subnet, module hash, fuel/memory, reciprocal bindings, push worker and account-removal wiring. A failure is a stop: fix the specific DEV-only configuration issue and rerun the check. A group's cached health balance does not establish every service's current fuel.

A successful check is *verification*, not activation of public routing.

## Phase 2 — separately authorised approval
After reviewing successful evidence, use the separately controlled DEV release path in `frontend/scripts/produce-routing-gates.ts` to record only the exact verified, revision-pinned governor approval. Do not guess a digest or call `record_routing_approval` with unverified values. Check the exact router, target alias `mainnet`, configuration revision and complete inventory before writing.

Then independently verify `read_routing_approval("mainnet")` and `read_public_group_targets`, plus the published frontend snapshot. The existing **[TEST] Open Group 2 to everyone** workflow's `snapshot` action commits a generated snapshot and may republish the frontend: **it is not the read-only preflight**. General group admission and routing approval are different gates.

Never use a PROD workflow or [TEST] settings/open/close action as a shortcut.