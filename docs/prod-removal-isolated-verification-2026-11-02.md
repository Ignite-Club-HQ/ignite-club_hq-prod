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

---

# Run 20 — independent external controller fencing verified (2026-11-02 23:08 UTC)

This section supersedes the fencing caveat in the record above: the independent
external controller check now passes on the supported worker. No production
canister, controller, database row, routing switch or approval state was touched.

## Run identity

| Field | Value |
| --- | --- |
| Workflow | `[TEST] Check complete two-group removal (isolated)` (id 404059142) |
| Run | 41540298706 (run number 20), `workflow_dispatch` |
| Job | `removal` (id 125602452675), `ubuntu-latest` |
| Result | completed / **success**, 22:48:13 → 23:08:18 UTC |
| Commit under test | `714c815be45d20ff434b8db0edecc2a06fcb3d79` |
| Evidence artifact | `two-group-removal-isolated`, id 13186394608 |
| Artifact digest (GitHub) | `sha256:35baa8d840817508fdc5ccbf440cb1acfa4029abe971ace3c4a84e4bbf5fee75` |
| Artifact digest (downloaded copy) | `35baa8d840817508fdc5ccbf440cb1acfa4029abe971ace3c4a84e4bbf5fee75` (matches) |
| Saved evidence copies | `docs/release-review/two-group-removal-run20-2026-11-02/` with `SHA256SUMS` |

All 13 test stages passed, including stage 12 `Check independent external
controller fencing (isolated)` and stage 13 `Run both receiver modes across all
28 frozen targets` (13 minutes). The four files the fencing stage depends on
match GitHub byte for byte: `external-controller-fencing.mjs`
`2c4deb01802f8b59310c2d119f906f0512681957`, `test-external-controller-fencing.mjs`
`2c2f5ae6b6d8ab6fb8383025adc9c94d012ceb31`, `external-controller-fencing.test.mjs`
`cb54fbcde67bae5b8c3a1749543f0e6c1d8ae3ee`, `test-two-group-removal-replica.mjs`
`588415c5c7453cba4cd375156ae7cf58f01f1452`.

## Independent external controller fencing — 11 checks, all passed

| Target | Controller before → after | Module | Live memory before → after |
| --- | --- | --- | --- |
| identity | `f7crg-kabae` → `fhcbw-237p4` | unchanged | 88251818 → 88252040 |
| witness | `f7crg-kabae` → `fhcbw-237p4` | unchanged | 44898179 → 44898401 |
| participant | `f7crg-kabae` → `fhcbw-237p4` | unchanged | 54697386 → 54697608 |

Proven in this stage:

1. Independent recovery acceptance is signed, armed and verified before any controller change.
2. Every target reads back exactly one independent controller with an unchanged module.
3. The independent lifecycle reader still authenticates every fenced target and sees the handover.
4. Fencing the witness preserves its recovery journal unchanged.
5. The former operator is refused control reads, re-adding itself, reinstalling and upgrading every target.
6. An unrelated principal cannot read or change control of any fenced target.
7. Fencing the witness itself invalidates the earlier signed acceptance until a fresh one is armed.
8. Fencing changes who controls code, not what the canister still refuses or serves.
9. A fresh signed acceptance restores recovery reads under fenced lifecycle counts; fencing is reversible.
10. Changing control of a participant alone, with the witness untouched, invalidates the signed acceptance.
11. Exclusive control returns only through the fence, leaving the accepted journal intact.

### The memory check, as it now runs

A refusal is only counted as a refusal when the target is otherwise untouched.
The rule that passed here is:

- Two controller reads taken with nothing between them must agree exactly on the
  module fingerprint and live memory. If even that moves, memory is not a usable
  signal and the test says so instead of blaming a refusal.
- The refused attempt is then judged against that settled reading taken
  immediately before it: the module fingerprint must survive and live memory must
  be byte-identical afterwards.
- Memory measured before the handover is deliberately **not** used as a
  comparison point, because the handover itself is legitimate management work
  that grows the target's own history (each target grew by 222 bytes during its
  handover, recorded above).

Recorded refusals (verbatim, per target): `Only controllers of canister … can
call ic00 method update_settings` (`CanisterInvalidController`) for a settings
write, the same rejection for reinstall and upgrade attempts, and `Only the
controllers of the canister … can control it` for a status read, with the
canister's controller list naming only the independent fence.

## Scenario results (from the artifact, not from the log tail)

| Scenario | mode | passed | checks | complete seals | terminal fencing | production authorization | release authorized |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rehearsal | `local-rehearsal` | true | 14 | 28/28 | true | false | **false** |
| Production receivers, rehearsal coordinator | `production-receivers-rehearsal-coordinator` | true | 14 | 28/28 | true | false | **false** |
| Signed production | `signed-production` | true | 18 | 28/28 | true | **true** | **false** |

Supporting suites in the same run: witness journal suite (3 checks, passed),
production identity/recovery transport suite (10 checks, passed), installation
report (passed).

## What this does **not** authorize

- `releaseAuthorized: false` in every scenario — the suite never authorizes
  release, erasure or opening.
- Nothing here upgrades, approves or opens PROD.

## Remaining sequence to open PROD

1. ~~Finish exact production permissions and removal checks across both groups.~~ Done.
2. ~~Verify in isolation on the supported GitHub worker, including independent
   external controller fencing.~~ Done — this run.
3. Upgrade PROD while it stays closed, then verify live permissions, removal
   behaviour and routing read-only. Requires separate owner approval.
4. Approve opening PROD separately.
