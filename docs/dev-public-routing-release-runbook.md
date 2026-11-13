# DEV public-routing approval — controlled release

**This is a live DEV release, not a read-only check.** DEV is branch `main`, project `deploy/mainnet`, router `jcdfe-vqaaa-aaaal-qxloq-cai`, on the ICP public network. PROD is separate: branch `prod`, project `deploy/prod`, router `tgfbl-qiaaa-aaaai-ayena-cai`. Never run or copy this against PROD.

## Prerequisite

Run `[TEST] Verify DEV public routing (read-only)` on `main` and review its successful `dev-public-routing-evidence` artifact. It must show the intended g2 group, exact canisters and controller/subnet/module hashes, sufficient execution cycles, reciprocal authorities, working removal wiring, and the expected configuration revision. The successful read-only workflow does **not** itself approve routing.

## Separate manual approval

Once evidence is reviewed, choose GitHub Actions → `[TEST] Approve DEV public routing (governor-verified)` → Run workflow on **main**. This deliberately has no push/PR/scheduled trigger.

Enter the exact `configurationRevision` from the read-only evidence in `expected_configuration_revision` (current observed DEV value was `0`; refresh this value if the group configuration has changed), and enter `APPROVE DEV PUBLIC ROUTING` verbatim. The protected `group-2-admin-controls` environment still requires its normal authorization.

The release checks the expected main branch, repo and pinned DEV router, restores the pinned DEV governor, then reruns a fresh **read-only** signed verification. It checks that evidence matches g2, target `mainnet`, the operator's explicit revision, complete service hash inventory and removal wiring; it pins the SHA-256 of the canonical approved configuration. Then, and only then, the existing `produce-routing-gates.ts` script re-reads and verifies all live services, checks the same configuration revision/digest and writes a single revision-bound approval on DEV's router. It awaits the approval readback, saves the matching generated DEV frontend snapshot, verifies the report, commits only that snapshot on `main`, and dispatches the existing DEV frontend canister publisher. No backend/group canisters are upgraded by this release.

## Verify completion

Check both the approval workflow **and** the separately dispatched `[TEST] Deploy web app (frontend canister)` run. A green approval run is not proof the frontend publisher completed. Read `read_routing_approval('mainnet')` and `read_public_group_targets` independently; compare current web build snapshot to the approved config. Then run a new disposable onboarding test with two independent Internet Identities. Never rely on the web app alone for ACL tests.

## Failure and recovery

If signed checks or digest/revision pin fail, **do not** bypass them. Fix the documented DEV-only issue and rerun the read-only gate. If the on-chain approval records successfully but committing or publishing the web snapshot fails, the app may keep using the old fail-closed snapshot. Inspect the report and commit state before retrying; republish the verified DEV frontend snapshot separately rather than blindly repeating approval writes. A group configuration change after publication invalidates approval until it is reviewed again.

The release intentionally changes which group directory can be exposed publicly. Do not invoke without the operator's separate approval.