# DEV ChatGPT first-content performance — exact staged Identity + Group 2 Club release

**Status:** DRAFT PR only. No merge, canister install, controller change, environment change or frontend deploy is authorised by this document. Keep PROD, Cloud Engines, Group 1 **Club Domain**, messaging, events, notification queue, PII/vetKeys and Supabase/email unchanged. Shared Identity *does serve Group 1*; an Identity upgrade can affect both DEV groups and requires Group 1 regression tests.

## Source and live evidence

The previous **read-only** workflow run [#44478590675](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/44478590675) succeeded at source `e7b74c79f7604e4383e957c826f5f34e2d4bf2d4` with action `check` and scope `dev_first_content_admission_preflight`. Its `all-group-upgrade-report` included identical old/settings hashes and 1T+ cycles for both live DEV canisters, complete G2-to-Identity wiring, registered group/subnet placement and G1/G2 original encryption key continuity. Plan hash was `ebde8a6546cdc2bea30abf99ff07c6c809c0f44aea2d07c5bc60f7c2621feb40`; **that old check hash is NOT an upgrade authorisation**.

| Stage | Exact installed canister | Pinned old Wasm SHA-256 | Pinned candidate SHA-256 | Pinned settings digest |
| --- | --- | --- | --- | --- |
| 1 — shared DEV Identity | `mq2sj-fiaaa-aaaal-qxlqa-cai` | `579d4d7983858cde6c6aa817c809159ccc1448a227a8947e58da7ef4fefa2b65` | `6fa6b030be740ccdcd0293fb463333e6e7eb4770ad9c3828ef3b65fbf914eb4c` | `d6752c81f2b0a38107b196f696dfe8a61f1c363f05fade25aec5d740db643e98` |
| 2 — DEV G2 Club | `yfwyv-nyaaa-aaaal-qxpyq-cai` | `84ea7c5c55a0e4d3ed3948a8780bcafb1ca8b696e6e7ee234f5eeb31700941b0` | `2a2361a11b76075d6cf9567e9667f72839ee5fe56ed0f23dd1d85860d171062f` | `80410bd8deeab72e2aedd1c28d0bd9d962ad742b43db30e5c84b9371e849deac` |

Both are on existing DEV subnet `e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe`, signed by existing governor `vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae`. No reader authority, G1 canister or PII key replacement is permitted.

## Recovery binary prerequisite — live release STOP until proven

The exact old module SHA-256s are known, but a hash or source revision alone is **not** a rollback binary. The isolated GitHub workflow `[TEST] Prepare exact DEV prior modules (no canister calls)` checks out immutable source revisions `4aeae3a09103b067ac289e602a1efa0b5ac757ca` (Identity) and `4b9650f219c2ee0985fd6deda5cb6670c14252f4` (G2 Club), builds the previous modules without any governor key, and archives binaries **only when both actual files match the pinned installed module hashes**. The job must complete successfully in a manually triggered `workflow_dispatch` on `main` before either stage can be installed.

For either live stage's `action=upgrade` input, a separate `recovery_run_id` is mandatory. The installer validates the successful main-branch recovery workflow metadata, downloads its `dev-first-content-old-modules` artifact and checks both Wasm byte hashes again before writing any install journal or invoking `icp`. Missing/expired artifacts, wrong hashes or a pull-request-only recovery run fail closed. The same completed main recovery run can support both independently approved stages if still available.

**Important:** Reproducing prior Wasm bytes does not prove state/memory downgrade safety. A separately reviewed state-preservation and stable-memory rollback rehearsal is still a manual release prerequisite.

## Manual-only protected workflow

[Stage DEV first-content Identity then G2 Club](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/workflows/dev-first-content-staged-upgrade.yml) uses workflow dispatch only. It is serialized against the existing mainnet governor workflow and requires the protected `group-2-admin-controls` environment. The **default action is check**, not upgrade. Both stages build both pinned candidate Wasms from the dispatched `main` SHA and run the existing exhaustive preflight *before* the stage action.

**Stage 1 — Identity, independent approval**

1. After reviewing/merging this PR, run `action=check`, `stage=identity` with both approval fields blank. Download `dev-first-content-stage-report` and inspect `first-content-stage/stage-check.json`; verify the hash and all live target/settings evidence. `stage-check.json` contains a **new source-and-live-specific** plan hash, not the preflight hash above.
2. Independently approve Identity only; provide that **exact stage check hash** in `checked_plan`, `confirmation=UPGRADE EXACT DEV SHARED IDENTITY FIRST`, `action=upgrade`, `stage=identity`. The workflow redoes the complete read-only preflight and refuses changed source, target/module/settings/wiring/key continuity/cycles/flag.
3. Before the one `icp canister install --mode upgrade` for **shared DEV Identity only**, the workflow journals a `pending` intent with acknowledged GitHub readback on the dedicated `dev-first-content-upgrade-receipts` branch. The exact installed hash must be the frozen old Identity hash; G2 Club must remain frozen old. Rust Identity uses existing governor init and no Motoko memory persistence flag.
4. After install, check the new Identity module hash, **unchanged** settings and unchanged old G2 Club module; journal `complete`. The workflow re-runs the exhaustive G1/G2 key/wiring/check preflight. Separately run signed read-only account/alias/eligibility, denial, unlink and original G1 club tests before authorising G2.

**Stage 2 — G2 Club, separate independent approval**

1. Only after the signed stage-1 regression review, run `action=check`, `stage=g2_club`, both approval fields blank. The live Identity hash must equal the pinned **new** Identity candidate; G2 Club must remain the pinned **old** hash; protected Identity journal must say completed.
2. Independently approve `stage=g2_club`, `action=upgrade`, supply the new stage-specific `checked_plan` hash and `confirmation=UPGRADE EXACT DEV GROUP 2 CLUB SECOND`. The runner writes a distinct pending intent and installs exactly one G2 Club Motoko Wasm **with** `--wasm-memory-persistence keep`. It never upgrades Group 1 Club, chat, events or PII.
3. Verify both new module hashes, unchanged settings, fresh G1/G2 key and Club wiring checks; test signed Group 2 club membership, roles, linked parents/children, revoked aliases, removal fences and authorization denials through the official DFINITY ICP plugin.

## Hard stops and recovery boundary

- Only current `main` source, two immutable service IDs, pinned candidate SHA-256s, original settings hashes and a fresh *stage-specific* plan hash pass; any new code or live drift requires another reviewed PR and baseline.
- No `icp sync`, frontend deploy, canister creation/top-up, G1 Club install, role/PII/data mutation, settings update, controller or key change occurs in this recipe. It does upgrade the shared Identity code, so G1 **behavioral compatibility requires separate signed acceptance**.
- **No automated recovery or retry**. Any unknown/failed install leaves a durable `pending` GitHub intent. Even if the module hash reads back as new, an operator must inspect and reconcile it through a separately reviewed recovery change; do not re-run the stage.
- The workflow does **not** activate `IGNITE_FIRST_CONTENT_COMBINED_ADMISSION=1`. Both stages require that setting OFF and retain the existing environment digest. Activation and before/after measurement are a **third, separately approved** action; not part of this PR.
- Historical *old* Wasm module hashes are recorded, but no backed-up old Wasm binary or automatic rollback has been established by this PR. Before approving an actual install, review preservation/reconstruction of the exact old module and stable-memory restoration approach. Do not equate installing an older Wasm with an automatically safe rollback.
- After separate activation, compare at least 10 authenticated connector runs under the same DEV account/club, including denial and revoked-account negative tests, to the prior Group 2 membership wall times of **6.839s initial / 6.231s repeated**. These times are not proof of backend savings.

**Review hold:** This PR prepares tooling and tests only. No live installation may be approved before (1) successful manual main-branch old module archive and exact binary checks, and (2) stable-memory upgrade/downgrade review with original DEV Identity and G2 state assumptions.  No live backend operation has been run, no CI result alone authorises an install, and no live latency improvement is claimed.
