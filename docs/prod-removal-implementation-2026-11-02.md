# Remaining PROD protection — consolidated engineering status

## Scope and current evidence

### Signed production account authorization implementation (2 November, 04:04 UTC)

Implemented separate stable account-reader authorization, not a widened rehearsal
or group-admission flag. Governor submission must carry an Ed25519 signature from
the immutable `IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY`, signing the exact
Candid body under a domain-separated SHA-256 payload. The body binds identity,
operator, fresh generation, expiry, complete expected inventory and exact verified
draft/lifecycle/configurations, plus independent original-inventory, runtime and
externally fenced recovery evidence hashes and recovery epoch. These hashes are
attested inputs, not a claim that the code itself proves evidence provenance.

Installation repeats authenticated live review while both groups are closed and
requires `IGNITE_PRODUCTION_ACCOUNT_WITNESS` to answer the exact consensus fence
request. That witness is compiled-in, cannot be identity or a receiver, and must
be an independently provisioned authority. There is no default signer, witness,
fixture fallback or self-approval. Inputs are structurally bounded before cloning,
verification or Candid serialization.

`read_service_account` and `read_linked_account` use the separate production
capability, fresh inventory/configuration/module/lifecycle collection and exact
recovery witness, then recheck governor, capability generation, expiry and local
history before synchronous reconstruction from the current identity index.
Linked-account callers are further restricted to exact club services. Eligibility
reads use this same verification when a production capability is installed;
existing eligibility-only grants never confer alias reads. Disable retains a
monotonic generation so old approvals cannot re-enable access. Removal begin,
history setters, completion, erasure, recovery and routing remain separately held.

**External recovery/fencing transport is still a hard blocker.** No implementation
or live provisioning of `verify_production_account_read_fence` is asserted here.
An echo receipt is insufficient: that authority must independently verify the
signed acceptance, retain anti-rollback epochs and prevent relevant remote changes
through the final release segment. A remote change during its last awaited reply
cannot be secured by additional local samples alone. Do not set the compile pins
or enable the capability until that transport, recovery and held-reply behavior
are independently implemented and exercised. Thus the identity authorization
path is implemented, but complete production authorization/release is not ready.

Found and corrected a source partition collision: private-name approval/write
journals already use 31/32. Completion now uses 33, capability 34 and request IDs
35. A direct partition test preserves distinct values in all three journals.
No existing partition is moved or decoded as another record type. If any older
completion-31 candidate was installed, its inventory requires explicit recovery;
this code does not silently relocate unknown rows or certify such an upgrade.

Expanded the isolated workflow with a non-rehearsal default-closed identity,
outsider refusal, persistent disable generation and preserved self account.
Positive production authorization remains source-unit-tested, not verified with
a real externally fenced transport. The native worker is still required for the
expanded runtime artifact; no GitHub dispatch credential exists in this session.

Validation: all 208 identity tests pass, including signed exact scope, missing
signer/witness, forged/mutated evidence, expiry, disable/replay, witness request
binding, oversized input and permanent partition isolation. Rust upgrade Wasm
builds; all 17 active contracts match; 24 isolated/recovery safeguards pass;
the expanded runtime script parses and preview reports build OK.

### Authenticated production review and expanded receiver tests (2 November, 03:55 UTC)

Added consensus `read_account_protection_configuration` to all twelve human
receiver types and the router/timer/workload infrastructure. Only the configured
identity may read it. It reports the actual guard's receiver, authority, protocol,
admission/removal flags and rehearsal mode; it grants no permissions or aliases.
The club media-registry read now admits the same exact configured identity in
candidate production removal mode, without opening ordinary registry/admin APIs.
Contracts and both generated binding trees were updated.

The production review endpoint now has real receiver APIs to call. It verifies
exact base/g2 and original router/media inventory, expected identity/module
hashes, closed groups, configuration revisions and bracketing replica lifecycle
counts. It returns only a draft with `release_authorized=false` and
`recovery_accepted=false`.

**This does not finish production authorization.** `read_service_account` still
requires rehearsal. A separately stored identity-owned accepted inventory and
scoped alias-reader capability, permission-preserving externally fenced recovery,
and a real non-rehearsal identity runtime flow are still required. Caller-provided
expectations and matching draft/fixture hashes cannot supply that acceptance.
No flag was widened and no production permission or release operation was added.

The existing manual two-group workflow now runs both receiver modes, checks
authenticated configurations and permanent completion, and clearly records that
identity coordination is still rehearsal. These expanded runtime scenarios have
not run: a fresh host probe reports gVisor writeBit=0 and no GitHub dispatch
credential is available. Owner execution on the supported native worker remains
necessary; it will not by itself resolve the unfinished identity authorization.

Validation: 201 identity, 56 router, 16 timer and 18 shared Rust tests pass;
24 isolated inventory/recovery/cleanup tests pass; Motoko protection and receiver
tests pass; all thirteen Motoko actors compile; Rust upgrade Wasm compiles;
17 active contract drift checks pass; preview reports build OK. No live upgrade,
funding, database change, routing approval or opening was run.

### Verified owner evidence and terminal completion batch (2 November, 03:32 UTC)

The uploaded `two-group-removal-isolated.zip` contains a successful supported-host
installation report and a successful real two-group report: ten checks passed,
28 complete seals and no unresolved infrastructure. This resolves the earlier
native-worker startup and actual two-group fencing/drain execution blockers.
Its mode is explicitly `local-rehearsal`; production release and full inventory
acceptance remain false. Do not reinterpret this report as production-mode acceptance.

Added `complete_account_removal_fencing` and authenticated completion readback.
Completion records now live in additive stable memory 33 (corrected from the
earlier unverified 31 candidate to preserve private-name journals), require fresh direct
zero-work seals for every frozen target, and preserve their immutable request,
account version, exact targets and seals. Replays return the same outcome without
advancing history. Conflicting or incomplete evidence is refused. History paging
now includes completion records and invalidates stale revision continuations.

Completion retains the account/data, subject fences, intent and configuration
locks. It deliberately does not change `removal_pending()` to unlock authorities,
erase records, release deletion tickets, reopen admission or accept restored
history. The endpoint remains governor/rehearsal-only pending production evidence.

The existing isolated two-group run now checks refusal while infrastructure work
is outstanding, outsider refusal, completion/readback, replay without mutation,
identity upgrade persistence, completion history export, retained authority locks
and continuing survivor photo/chat/Vault access. This extended runtime scenario
has not run here: the measured sandbox host cannot execute Motoko PocketIC actors,
and no authorized GitHub dispatch credential is available.

Local validation: 197 identity tests and 30 isolated/recovery/workflow safeguards
pass; all 17 active Candid contracts match. These tests are not live acceptance.

**Still required before a closed PROD upgrade:** authenticated independently
pinned original/base plus g2 expectations, receiver readiness and lifecycle
evidence, exact scoped production account readers without the broad rehearsal
gate, complete held-callback/original-schema acceptance, and authenticated
permission-preserving recovery with external anti-rollback fencing. Existing
offline expected-inventory equality is not provenance, and the bound-deletion
release is not this release. No production release setter or approval recorder
was added to bypass these missing engineering pieces.

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

### Continued installation diagnosis and consolidated worker handoff (02:20 UTC)

The root environment incompatibility is now independently demonstrated: a native
C write to a read-only page receives SIGSEGV with `REG_ERR` write bit **0** on
this gVisor host. IC's x86-64 memory tracker uses that bit to distinguish reads
from writes, so it repeatedly restores read-only protection for the same write.
This does not establish an invalid Motoko artifact. Changing compiler persistence
flags or downgrading PocketIC is not an accepted workaround.

Sources: [gVisor signal context](https://github.com/google/gvisor/blob/master/pkg/sentry/arch/signal_amd64.go),
[IC memory tracker](https://github.com/dfinity/ic/blob/master/rs/memory_tracker/src/lib.rs).

`removal-host-fault-probe.c` and `removal-host-preflight.mjs` now measure the actual
fault before PocketIC starts. The real preflight rejects this host in 369 ms,
saving a negative hash-bound report; it no longer wastes a stalled installation
attempt. It does not patch the runtime or grant any acceptance.

The existing manual `[TEST] Check isolated removal test installation` workflow
keeps its path, compiler and pinned PocketIC version. After a supported host and
real minimal install/ping succeed, the same run builds the seven remaining real
receiver services and runs observed held-admission races, fresh drains/seals,
survivor access, upgrade fencing and candidate configuration-off checks in both
rehearsal and production-candidate modes. Saved per-service reports bind exact
Wasm hashes and explicitly deny full-inventory/release acceptance. Test authority
replies are fixtures; this does not prove real identity, encrypted data or complete
twelve-service/two-group infrastructure acceptance.

Validation: 31 host/cleanup/workflow/release safeguards and 197 existing identity
tests pass. YAML and receiver-runner syntax validate; preview build is healthy.
Native-worker execution is still unverified: no authorized GitHub dispatch
credential is available here. The next external step is this TEST workflow on
`main`, not a PROD upgrade, payment, settings switch or approval workflow.
Terminal commitment and authenticated full-inventory/recovery integration remain
unfinished; their safe implementation boundaries were investigated, not released.

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