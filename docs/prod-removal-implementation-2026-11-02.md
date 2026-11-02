# Remaining PROD protection — consolidated engineering status

## Scope and current evidence

The owner's 2 November report shows configuration revision 5, base and g2,
zero execution-fuel shortfall, and zero additive lifecycle calls left. Previous
closed wiring readback verified the photo quota registry and worker grants.
No additional payment or repeat wiring is required by that evidence.

This source batch changes no live canister, account, database, routing approval,
push schedule or opening state. PROD remains closed; DEV keeps its own canisters.

## Fixed in source

1. The routing reviewer no longer recommends `IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL=1`
   on PROD. Disabled is the correct diagnostic expectation. Enabling it cannot
   pass the production gate, even with a matching recorded routing approval.
2. Existing g2 eligibility inventory validation accepts the independently pinned
   `prod` deployment as well as existing `mainnet`. Every placement must still
   match the exact binding, host, network and revision. Mixed/foreign deployments
   fail; base is still excluded from this narrow new-group authorization.
3. Approval draft readiness is distinct from matching recorded approval, removing
   the first-approval circularity without authorizing a write. Unreleased service
   protection still suppresses all drafts.
4. The additive wiring planner no longer advertises an unaudited competition
   setter that the executor refuses. Every ready call remains in its reviewed
   execution allowlist; differing authorities are never overwritten.

## Required engineering before release — not settings-only fixes

### Candidate implementation added in source

The twelve Motoko consumers now distinguish legacy, rehearsal, candidate
production admission and candidate production removal control. Removal without
admission, or rehearsal mixed with production flags, denies admission. Candidate
flags are not set by deployment or setup tools. Club alias expansion remains
separately rehearsal-gated; eligibility cannot implicitly release alias reads.

Retained receiver fences deny entry even after configuration is disabled, keep
legacy account queries closed and allow existing holds to settle. No stable
Motoko fields or applied migrations changed. Identity service ownership rejects
deletion reservations and filters stale account-index aliases. Full seal
validation requires exact distinct target coverage and zero outstanding work.

Verification: all twelve Motoko canisters compile; shared mode/fence assertions,
191 identity Rust tests and 12 protected-read adapter tests pass. Seven receiver
artifacts build, but the actual local replica runner times out installing its
test relay before any service scenario begins (tested PocketIC 15 and the
package-matching 14). Held callback, configuration-off upgrade and encrypted-data
acceptance therefore remain unverified. Tests are not production evidence.

This is **not a completed removal release**: no independently accepted base/read
inventory, terminal erasure bridge, complete infrastructure/provider draining or
production recovery transport was added. No live setting, upgrade, database,
approval, payment, push activation or opening was performed. Do not run a flag
change or a production upgrade based on this candidate alone.

### Independent expectation comparison

`identity_access/src/expected_removal_inventory.rs` now compares complete
base/g2 evidence against a separately supplied expectation. It preserves role
and placement tuples, revisions, original supplemental infrastructure and each
club's full store list; reordered equivalent rows pass, while duplicates,
omissions, substitutions and extra allowlisted authorities fail. An internally
consistent observation that omits the expected router fails explicitly.

This private offline validator has no Candid API, persistent state, trust pin,
admission grant or erasure/opening action. It is not connected to production
release: independent evidence provenance and authenticated acceptance remain
required. Six focused tests pass.

Local replica diagnosis also reproduces the stall installing a minimal actor,
with both encoded-empty initialization and legacy persistence. Creation works;
installation does not finish. The relay alone is therefore not established as
the cause. The runner now names its failure stage and attempts bounded cleanup
before always stopping its own local server. No real receiver pass is claimed.

### Approved completion plan — installation prerequisite (2 November, 02:09 UTC)

Added `backend/shared/test/removalInstallProbe.mo`, a disposable actor whose
`ping` must return exactly 1, and `frontend/scripts/removal-install-preflight.mjs`.
The preflight records the pinned PocketIC 14.0.0 binary hash, actual probe Wasm
hash, failure stage and elapsed time. Its report explicitly denies release and
receiver acceptance, even when installation succeeds. The remaining-receivers
runner now requires this preflight before starting any service scenarios.

`removal-local-supervisor.mjs` binds only loopback and owns a detached local
process group with a hard lifetime. Cleanup sends signals only to that owned
group, terminates hung descendants and never scans for unrelated processes.
Three concrete tests cover missing/relative binary refusal, lifetime bounds and
termination while preserving a separate unrelated process. Together with
workflow naming and routing guards, 25 tests pass; identity baseline is 197
passing tests and the separate release-gate baseline is 19 passing tests.

The current real probe failed at **install minimal actor** after about 42 seconds
and wrote a negative report; it did not begin receiver scenarios. Independent
local diagnosis installed raw empty Wasm and a memory/data-only Wasm successfully,
while the Motoko actor stalled after successful compilation. The runtime repeated
a memory-protection fault loop. This narrows the fault to Motoko runtime execution
in the local test environment, but establishes no supported workaround. Shutdown
panics after terminating owned processes are not the original cause.

Manual workflow `[TEST] Check isolated removal test installation` runs the same
real probe on an isolated Ubuntu worker, with no governor credentials, mapped
canisters, mainnet calls or release action. It saves `removal-installation-only`
evidence even on failure. A successful run is **only** the environment prerequisite
for completing real twelve-service acceptance, not authority to deploy or open.
This sandbox has no available GitHub execution credential, so the workflow has
not been dispatched here. No PROD approval recorder or admission activation has
been added by this installation-preparation batch.

| Work | Required behavior | Existing implementation / gap |
|---|---|---|
| Base acceptance | Independently validate original/shared and supplemental authorities, not just allow `base` as a group name | `identity_access/src/admission.rs` only releases new-group readers |
| Production guards | Authenticate exact readers, preserve resource permissions and fences before/after awaits, reject outages | Distinct candidate modes compile; complete real-service acceptance and production release remain held |
| Account ownership | Return only current, nonpending account aliases to approved production services | `lib.rs::service_account` remains rehearsal-only |
| Complete removal | Freeze exact inventory; drain every receiver; persist immutable terminal outcome without discarding fences | Existing begin/advance/seal preparation has no terminal completion bridge |
| Infrastructure and delivery | Classify every frozen target and preserve uncertain provider/worker obligations | Twelve human receivers are not complete infrastructure acceptance |
| Recovery | Preserve full denial/fence/history ledgers with authenticated external fencing and independent anti-rollback evidence | Existing adapter core is offline, not a production transport |
| Acceptance | Positive real encrypted-data controls, all-group held callbacks/outages/retries/upgrades without rehearsal | Existing local suites are partial, not all-path production evidence |
| Approval recording | Protected PROD-only reviewed evidence, revision CAS, durable intent/readback, unknown-reply reconciliation | Current snapshot writer is DEV-bound and must not be used |

Bound deletion is independently released timing protection; it does not prove
full service draining or account-removal completion. Identity eligibility is not
club membership, and repeated checks are not atomic global revocation.

## Rollout boundary

Finish the above code and consolidated local acceptance before preparing any
closed-only production upgrade/release plan. The owner reviews exact modules,
inventory, settings, migration compatibility and key preservation before a signed
GitHub execution. Recheck live results afterwards. Approval recording and opening
remain distinct, separately reviewed actions. Do not use an older green fixture,
a flag-only fix or the DEV deployment workflow to bypass these prerequisites.