# Isolated two-group removal verification — passed (2026-11-02)

Read-only record of the first fully green run of the complete isolated removal
suite. No production canister, controller, database row, routing switch or
approval state was touched by this work.

## Run identity

| Field | Value |
| --- | --- |
| Workflow | `[TEST] Check complete two-group removal (isolated)` (id 404059142) |
| Run | 41524620386 (run number 15), `workflow_dispatch` |
| Job | `removal` (id 125549045537), `ubuntu-latest` |
| Result | completed / **success**, 21:02:12 → 21:24:58 UTC |
| Commit under test | `6db4c8410ab44dcb8e6b31cd5da32c47e59c4dfd` |
| Local HEAD at review | `6db4c8410ab44dcb8e6b31cd5da32c47e59c4dfd` (identical) |
| Evidence artifact | `two-group-removal-isolated`, id 13181490120 |
| Artifact digest (GitHub) | `sha256:1c8e5d8ec0ada874be3a71e2c6d9ed1cdde7b024da0ea96dd2850e05f6beaa0f` |
| Artifact digest (downloaded copy) | `1c8e5d8ec0ada874be3a71e2c6d9ed1cdde7b024da0ea96dd2850e05f6beaa0f` (matches) |

Every step in the job succeeded, including step 12 `Run both receiver modes
across all 28 frozen targets`, which runs all three scenarios under
`bash -e` — any failing assertion aborts the job, so a green job means all
three scenarios completed.

## Scenario results (from the artifact, not from the log tail)

| Scenario | mode | passed | complete seals | terminal fencing | production authorization | release authorized |
| --- | --- | --- | --- | --- | --- | --- |
| Rehearsal | `local-rehearsal` | true | 28/28 | true | false | **false** |
| Production receivers, rehearsal coordinator | `production-receivers-rehearsal-coordinator` | true | 28/28 | true | false | **false** |
| Signed production | `signed-production` | true | 28/28 | true | **true** | **false** |

Supporting suites in the same run:

| Evidence file | sha256 | Result |
| --- | --- | --- |
| `two-group-removal-rehearsal.json` | `a710e2deccde38d7ad011f0d3a656d76adae6c8e03be80d1babb158f092b3675` | passed |
| `two-group-removal-production-candidate.json` | `f64d210ebe8237422a7516087aff31835835701f5fdd4d0a8403b3755c0ded18` | passed |
| `two-group-removal-production.json` | `1ffdf900220dcd2d6ed4b5fea4b587feb703c53bf08e2b42c4cb0d098ac2595c` | passed |
| `production-recovery-integration.json` | `e86ef8ecb91050fa11c89d667c28604b2e025376fb9a4a8b71e85b2bafa301fd` | passed; `externalControllerFencing: false`, `productionAuthorization: false` |
| `account-recovery-witness.json` | `3f125ad3edf546a305eb6ee86e6232f180e8ac58436b1fbbcef2a1826ff2eebd` | passed; `productionIntegration: false` |
| `removal-install-report.json` | `560e839ffc073882d755ed931fed3bb3580251adfbcc95b064f60f43ad3e22d7` | passed; installation-only |

## What the signed-production scenario proved

All 18 checks passed, including the three that previously failed runs:

1. `Survivor retains real two-group photo/chat access immediately after removal
   starts without renewed approval` — one member's pending removal no longer
   locks out every other member.
2. `Upgrades invalidate the signed review; after fresh approval prepared/sealed
   progress preserves survivor access` — a deliberate receiver upgrade correctly
   refuses readers with drift until a fresh signed approval, and access is then
   restored with the generation unchanged.
3. `Completed-removal retries preserve survivor reads under the unchanged signed
   capability` — retries after completion do not need or grant a new approval.

Also held throughout: both aliases denied by every unreached and upgraded
receiver; 24 human receivers plus two timers, shared workload and router all
sealed (28/28); infrastructure obligations settled by the governor; fences
survive router, workload and timer upgrades; ciphertext, Vault and chat history
retained for survivors; other-group private access preserved; immutable terminal
fencing completion survives replay and identity upgrade.

## What this does **not** authorize

- `releaseAuthorized: false` in every scenario — the suite never authorizes
  release, erasure or opening.
- Independent external controller fencing/draining is still unverified
  (`externalControllerFencing: false` in the transport evidence).
- The recovery witness ran isolated only (`productionIntegration: false`).
- Nothing here upgrades, approves or opens PROD.

## Remaining sequence to open PROD

1. ~~Finish exact production permissions and removal checks across both
   groups.~~ Done — signed production authorization is true.
2. ~~Verify in isolation on the supported GitHub worker.~~ Done — this run.
3. Upgrade PROD while it stays closed, then verify live permissions, removal
   behaviour and routing read-only. Requires separate owner approval.
4. Approve opening PROD separately.
