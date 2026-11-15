# DEV Group 2 roster-name paired release

**Status:** prepared, not run. This repository workflow is restricted to the existing two Ignite **DEV** canisters on the **ICP public mainnet**. This is not a local test replica and is **not** the independent Ignite PROD environment.

## Why this pair

PR #1538 merged the authoritative club-domain parent roster and same-team child-name PII authorization. The live Group 2 Club canister initially did not expose `read_account_list_team_child_ids` or `read_can_team_child_name_visibility`. Changing the web frontend alone does not install either backend method.

Only these existing canisters may be upgraded, in this order:
1. **PII** `zt5a6-yiaaa-aaaal-qxp5q-cai`, with the original vetKD `key_1` and verification public-key fingerprint retained. The new PII code fails closed against an old Club canister lacking the trusted authorization method.
2. **Club** `yfwyv-nyaaa-aaaal-qxpyq-cai`, restoring same-team names and canonical child assignment reads.

The existing Group 2 `notification_queue`, Events, identity/router, media, shared G1, PROD, frontend, membership, and messaging canisters are not upgrade targets. No notifications or child/PII updates are part of this release.

## Manual check (not approval to upgrade)

After a separate review and merge of this workflow, open `Actions → [TEST] G2 roster + PII name pair upgrade (owner gated) → Run workflow` on `main`.

Choose `action: check` and leave confirmation and all hash fields **blank**. The workflow compiles exactly two source artifacts and reads the pinned live router/placement, controllers, memory/cycles, existing wiring and settings plus the public PII verification key fingerprint. It never calls `icp canister install` in check mode. Download the `g2-roster-name-pair-report` artifact's `check.json`. Confirm all fields are populated and that the preflight did not report a mismatch.

The workflow uses the repository's protected `group-2-admin-controls` environment and existing governor identity. A green GitHub PR test is **not** a live deployment approval.

## Separately approved upgrade

Only after reviewing a fresh completed `check.json`, decide whether to authorize the live DEV upgrade. For `action: upgrade`, enter exact `UPGRADE G2 ROSTER NAME PAIR`, the `sourceSha` from the check file, and each existing PII/Club `oldHash` from the two exact `targets`. The workflow also requires the running `main` commit SHA to match, and checks the current live hashes, pinned router configuration and governor.

The runner binds an immutable two-step release journal on the dedicated `g2-roster-name-readback-receipts` branch. Before each install it writes and re-reads a verified pending receipt at the acknowledged GitHub commit; ambiguous upgrade outcomes **stop** and are never replayed blindly. After each install it verifies controller, subnet, running/cycles, stable memory, environment settings, wiring and module hash. After the PII install it additionally requires the original vetKD verification-key fingerprint to remain unchanged. The Club install must not run if the PII key check fails. The workflow never reinstalls a canister, changes settings, rotates keys, creates a club/child, or performs a wholesale data read.

If the journal is pending or any hash, key, settings, memory or wiring check fails, **do not rerun upgrade** until independent read-only reconciliation establishes the exact state. A failing key-continuity check is a serious release incident, not a prompt to rotate a key.

## Browser acceptance after completed release

1. Open the ICP-hosted Ignite DEV site: https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net
2. Sign in as the Test full access account and view `ChatGPT Plugin Test U10` in `Group 2 test`.
3. Confirm the team member/player list loads without `Forbidden` and the already-created Ted and distinct new test child remain linked to the U10 team.
4. Check authorized parents and coaches see teammates' **names and roles** but do not see names from unrelated teams. Do not expect emails, private family information, or club-wide roster access.
5. Re-check the official DFINITY connector manifest for the two exact service IDs and live Club Candid methods. Verify the existing child IDs with caller-authorized readbacks. Never recreate Ted or repeat a child write to test roster loading.
6. If encrypted names are still hidden, debug authorization and PII readback without modifying children, keys, contacts, notification settings, or PROD.

**Known limitation:** CI's existing PocketIC security tests and the pair-policy tests are useful preconditions but are not a substitute for a separate live signed-in browser acceptance. Neither a merged PR nor a green frontend deploy proves the backend was upgraded.
