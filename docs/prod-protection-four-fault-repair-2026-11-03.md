# Closed protection commissioning — four-fault repair

## Implemented

1. **Already-installed identity:** initial preparation now accepts either the independently reviewed program or the recorded original. The reviewed program skips reload; an unknown program is refused before the activation receipt is created.
2. **Mandatory final verification:** both `protection-delivered` and `verified` delivery invocations run fresh final checks. Reconciliation of an acknowledged authorization continues to verification without sending approval twice. Current expiry, exact stored approval and reviewed receiver programs/controllers/subnets are rechecked.
3. **Settings privacy:** settings intent before/after images are SHA-256 commitments of sorted unique name/value rows, never plaintext environment arrays. The matching probe uses identical normalization. Unrelated values are preserved in memory during updates, and duplicate names fail closed. Commitments are not encryption; they avoid publishing plaintext, not every inference about low-entropy values.
4. **Current subject safeguard:** a new bounded witness method verifies the exact current global acceptance and separate subject signature/body, both arming cells, current witness/participant lifecycle, expiry and unchanged snapshots across awaits. Identity's active-protection readback calls this method and rechecks immutable witness program/controller pins after the call. No fabricated people, account enumeration, disclosure, new stable partitions or opening authority were added.

The obsolete retry helper now follows the same submission-proof rule as the actual journal. Receipt saves advance in-memory authoritative state only after acknowledged persistence.

## Same orchestration, not a duplicate test sequence

`prod-protection-runner.mjs` is the single commissioning orchestration used by the production composition root and isolated tests. It requires explicit adapters and has no default live transport. `prod-protection-live.mjs` retains its unconditional hold before loading network/key adapters; no flag bypass was introduced.

The offline runner suite invokes plan and all seven stages, retaining JSON receipts between fresh runtime invocations. It uses real Candid encoding, separate Ed25519 signatures, request-bound BLS-signed test certificates, and the production evidence verifier. Tests cover reviewed/original/foreign identity, settings preservation/no plaintext persistence, all-28/24 final results, signing-stage reruns, inventory and authorization completion loss, process loss after authorization, failed final readback and subject disarming. These are **offline adapters**, not the actual deployed canisters, GitHub API, cold workflow installation or separate OS processes.

Both GitHub workflows now include the actual-orchestration runner suite. The existing real-canister isolated transport scenario additionally exercises the new witness endpoint and same-body reacceptance disarming. The real all-28 signed-production scenario now compares JS/Rust account/recovery/subject signing bytes and proves identity active readback rejects subject disarming then succeeds after fresh separate authorization.

## Validation completed locally

- **51 JavaScript checks passed**, zero failed/skipped: policy, journal, certified evidence, review, runner and promotion manifest.
- **229 identity Rust tests and 20 witness Rust tests passed**; shared protocol includes current global/subject effectiveness regression.
- Both Rust programs compile to release Wasm.
- **17 active Candid contracts** pass drift checks; new witness method and both binding trees regenerated.
- Both workflow YAML files and touched runner/integration scripts parse successfully.
- Independent review found no concrete serious defect in the four repairs as composed, and identified the deployment/coverage limitations below.
- Preview telemetry remains build OK.

## Still required before live activation

**The installed witness is an older program.** The fourth repair adds a method and changes its fingerprint. The commissioning runner intentionally does not upgrade the recovery-key-controlled witness or silently rewrite its immutable receipt. A coordinated owner-reviewed witness upgrade/pin transition is required: preserve the witness address, recovery controller and signing keys; retain before-images and acknowledged upgrade intent; read back the exact new witness program; rebuild/upgrade identity with that reviewed fingerprint; obtain fresh lifecycle-bound acceptance after programs/settings settle. Existing protection setup refuses drift; do not bypass it.

The new real-canister assertions have **not run on the supported GitHub worker yet**; this sandbox's known PocketIC host limitation remains. The offline complete-runner suite is not a deployed-adapter end-to-end proof. GitHub API acknowledgement emulation, cold recipe acceptance, separate-job-process execution and exhaustive crash boundaries remain broader acceptance work beyond the tests completed here.

No PROD copy, workflow dispatch, owner approval, witness/identity upgrade, protection activation, database/routing/data change or opening occurred. The release hold remains intact. This repair batch is not a claim that safeguards are live or that every runtime fault has been eliminated.