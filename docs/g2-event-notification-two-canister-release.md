# Group 2 notification security/readback — two-canister release runbook

**Status: prepared only, not run.** Both features were merged to `main` in commit `6e30a8c75332f09aedb10362809140fc91f17681` from PR #1513, but the running G2 canisters are not upgraded by that merge. G2 is **ICP public mainnet**, even though the test club is accessed via a DEV-labelled app. The existing `upgrade-group2.yml` installs up to 13 services and must **not** be used for this change.

## Exact scope and order

1. `notification_queue`: `zu4gk-vqaaa-aaaal-qxp5a-cai` — enforce trusted canister-only `event_invite` writers and canonical ID/key namespace, plus a restricted status read.
2. `club_domain`: `yfwyv-nyaaa-aaaal-qxpyq-cai` — provide the signed, permission-scoped Test2 readback broker.

No G1, other G2 canisters, PROD backend/frontend, routing, controller, secret, notification device token or queue entry should change. There is **no** new event notification or mobile push in the upgrade workflow.

## Protected GitHub workflow

`[TEST] G2 event-notification paired upgrade (owner gated)` — `.github/workflows/g2-event-notification-pair-upgrade.yml`

This workflow has no push trigger and the PR job runs **only local policy tests, without secrets**. Manual operations are restricted to the `main` branch, serialized using `ignite-mainnet-governor-deployment`, and use the protected `group-2-admin-controls` environment with the existing governor identity. No separate developer or external reviewer is required by the code; the repository owner explicitly controls whether and when to run the installation.

### First: read-only check (no deployment)

Select **Run workflow → action: check** and leave confirmation, release SHA and both old-hash fields blank. The check signs in using the existing governor but does **not install, fund, change settings, enqueue notices or write to a canister**. It:

- Builds the two service Wasm artifacts from the checked-out main source.
- Pins exact G2 IDs and verifies provision file, subnet, mainnet group routing and registry configuration.
- Verifies the sole governor controller, running state, minimum 1T cycles per target, module hashes, preserved environment settings, and old/new expected Wasm hashes.
- Reads only bounded governor-authorized canister configuration (`read_group_opening_configuration`), stable-byte metrics and aggregate club counts, **not** queue contents or notification tokens.
- Produces artifact `g2-event-notification-two-canister-report` with `check.json` recording the source SHA, old/new hashes, configuration snapshot and target status.

A successful read-only check is **not** approval for the upgrade.

### Separate upgrade approval

If the owner explicitly chooses to deploy the two canisters, select **Run workflow → action: upgrade** from the same exact main release. Provide:

- Exact `expected_release_sha` from `check.json` (must match the running workflow's GitHub commit).
- Exact `expected_queue_hash` and `expected_club_hash` from the read-only check.
- Confirmation: **`UPGRADE G2 EVENT NOTIFICATION PAIR`**

All inputs are checked **before obtaining the governor PEM**. The governor, routing, current hashes, Wasm artifacts, controller, cycles, subnet and authorization wiring are rechecked. The release refuses stale inputs or a different source commit.

The runner persists an immutable, release-bound upgrade journal to the dedicated `g2-notification-readback-receipts` branch, with GitHub-acknowledged commit-and-blob readback **before any canister installation**. The journal records `ready → pending → complete` for each exact service. If the upgrade outcome is unknown, the runner stops; **it never blindly retries a pending install**. The existing `upgradeArgs` applies `--mode upgrade --wasm-memory-persistence keep` and the original governor canister initialization argument, with no reinstall. Only the listed pair may be upgraded; the queue is installed first. Post-upgrade checks verify fingerprints, settings and wiring, with aggregate telemetry checks for unexpected data loss. No identity/wiring setters are invoked.

### After a successful installation

Verify the exact deployed module hashes again, the G2 permission/club wiring, existing event/reminder regression behavior and Test2-only notification readback without sending new notifications unless separately approved. A queue status of `delivered` would mean worker/provider completion, **not** device display or that a user read it.

The existing Test2 invitation was created **before** this trust-policy change, so its provenance cannot be retroactively authenticated merely by the upgrade.

## Failure and recovery

- **Preflight or approval failure:** stop; no canister changes. Re-run `check` only after resolving source/registry/cycles mismatches.
- **Error after the first install:** the queue may already be updated while Club remains old. Inspect the durable journal, current module fingerprints and wiring before any retry. The updated queue is intentionally fail-closed for forged invitations.
- **Unknown result / pending journal:** never auto-replay; first determine from authoritative canister status and release logs whether the install completed. The journal only reconciles a pending step when its deployed module hash equals the exact staged build.
- **Potential stable state problem:** stop immediately. There is **no automatic rollback**; reverting code can fail if stable schema has changed. Preserve the original module hash, reports, upgrade receipt and production backups before considering any reverse upgrade.
- **Key/access or cycle problems:** stop; no implicit cycle minting, top-ups, controller/setting edits or fallback to the broad thirteen-canister workflow.

This workflow deliberately leaves the pre-existing Group 2 router and opening-manifest fingerprints unchanged. If a separate governance/publication process requires refreshed post-upgrade fingerprints, prepare that as a distinct verified change — do not automatically rewrite routing configuration from this runner.
