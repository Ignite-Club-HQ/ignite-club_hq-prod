# Account recovery protection — candidate, not live acceptance

## Implemented

### Signed full-service candidate (04:54 request)

The identity now supports separate signed inventory provisioning and signed full
account-fencing control. Generic setters remain rehearsal-only. Provisioning
checks all real closed groups, media registries, receiver configurations and
module/lifecycle evidence before persisting pins; an independently accepted
witness must match the inventory-purpose approval. The exact receipt is retained
in additive memory 38. Reader-only signatures do not authorize fencing.

Starting removal repeats current signature expiry and exact authorization,
inventory and account checks immediately before persisting a fence. Existing
frozen jobs can continue after expiry; new inventory/history requests cannot.
The full-service isolated scenario uses real non-rehearsal identity and witness,
ephemeral signers, 24 human receivers and all four infrastructure targets. It
reuses actual encrypted-photo, chat, Vault, retry and upgrade tests. Its local
inventory evidence is not PROD provenance and never authorizes opening.

Important remaining limitation: mutable removal history and participant upgrades
invalidate the signed read acceptance. The isolated runner explicitly renews
acceptance before checking surviving members; an automatic governed renewal
path is not implemented. Do not deploy or claim uninterrupted production
admission from this candidate. Full fencing retains data; it is not destructive
account erasure. Supported-worker execution and evidence review remain required.

- A separate Rust `recovery_witness` stores complete immutable removal subjects,
  exact targets, per-target progress and completion records outside participant
  backups. Stable indexed pages retain replayable records, not just hashes.
- Exact retries return their original revision. Conflicting intents, premature
  completion, foreign targets and regressing progress refuse. Each new event
  advances an epoch and closes any accepted read fence.
- Independent compile-pinned Ed25519 recovery acceptance binds witness and
  identity, witness IC version, exact journal revision/hash, complete inventory,
  decoded-history commitment, identity history/removal generation/version,
  account approval digest, expiry and every participant module/lifecycle count.
- Witness restore/upgrade cannot reuse an armed application flag: the IC version
  must match and upgrades explicitly disarm. Identity requests include current
  history/removal/version and recheck them synchronously after the response.
- Whole-group offline recovery now rechecks the independent anchor before every
  snapshot/load/start, after starts and before finishing. Snapshot loads always
  restore receivers before identity regardless of checkpoint array order. Resume
  binds complete saved snapshots/history and refences on interrupted starts.

## Tests and execution boundary

## Continued integration

Identity now retains pending operations and acknowledgements in additive stable
memories 36/37. Removal begins with atomic local subject fencing and a staged
external record; receiver progress and completion are acknowledged through the
independent journal before success. Unknown write/readback outcomes leave the
exact pending operation retained and admission closed. Completion retries obtain
fresh receiver seals rather than trusting cached historical completion. Local
acknowledgements never skip independent readback after a restore.

Reader disable stages an immutable identity/generation record and clears local
approval before any await. A failed external acknowledgement retries the same
generation; bounded governor reconciliation can finish pending records. The
witness exposes identity-authenticated exact record readback, and independently
retains disable records alongside removal progress.

An exclusive local recovery journal uses a non-expiring lock, atomic synced
receipts, revision checks and explicit completed-resume release. Interrupted
work cannot acquire an automatic replacement lock. This is local writer
serialization, **not** the missing remote controller fencing transport.

Rust tests cover exact signatures, old identity history/version, old acceptance,
epoch advancement, record bounds, inventory size, and stable journal reopening.
Offline tests cover old/partial checkpoints, lost progress, anchor changes during
loads/starts, pending intents and receiver-first restore. The existing manual
`[TEST] Check complete two-group removal (isolated)` workflow now also installs
the actual witness and exercises real snapshots/upgrades and both-group journal
retention. Its artifact is `account-recovery-witness.json`.

The sandbox's native memory-write fault limitation still prevents running the
actual Rust/Motoko replica suite here. A supported GitHub worker must execute it;
passing offline/unit tests is not a substitute.

Verified locally: 11 witness tests (including actual stable journal retries and
both-group completion), 208 identity tests, 26 recovery/evidence/host regressions,
17 active contract checks and both Rust Wasm builds. The real snapshot runner was
attempted and stopped at host preflight (`writeBit=0`, gVisor), before installation;
its report is explicitly failed and grants no runtime acceptance.

## Still held — do not configure or deploy pins

## Additional production-mode isolated transport coverage

The manual isolated workflow also runs `test-production-recovery-integration.mjs`.
It preallocates local identity/witness principals, generates two ephemeral signing
keys in memory, and compiles immutable public pins into separate artifacts under
`target/isolated-production-recovery`. Neither private keys nor these Wasms are
uploaded or used by deployment workflows. The identity never enables rehearsal.

The suite verifies positive signed witness acceptance with live participant
lifecycle evidence, forged/wrong/stale request refusals, restoration of an accepted
witness snapshot, real identity-to-witness disable writes and exact readback,
interrupted disable retry preserving generation, independent progress surviving
identity restore/upgrade, participant upgrade drift, and expiry. Signed inventory
and decoded-history digests in this limited tier are isolated fixtures, not
production provenance. Witness request ingress impersonation is explicitly not
proof of a complete real receiver-to-identity-to-witness authorization chain.

Evidence is `production-recovery-integration.json`. It always records full reader
authorization, complete inventory acceptance, external controller fencing and
release authorization as false, even when its transport checks pass.

Fresh non-rehearsal full account authorization still lacks a governed bootstrap
for required supplemental inventory. Existing generic setters must remain gated;
temporarily enabling rehearsal would manufacture invalid acceptance. A separate
signed exact-scope provisioning design and actual full-service positive read flow
are required, together with independently exclusive remote controller fencing.

## Remaining production prerequisites

The witness has no DEV/PROD mapping, deployment recipe, active signer or controller
grant. No canister, database, routing, delivery or production data changed.

Before production can open, implement and verify the exclusive authenticated
controller fence/drain transport, exercise the removal/disable integration with
the actual independent witness, and reconcile complete decoded identity/receiver
denials, pending operations, leases and quota ledgers before recovery acceptance.
Current production removal endpoints remain closed; recording a witness claim
does not make production removal complete or authorize opening.

A held witness reply can overlap an external epoch change; lifecycle sampling
alone is not an exclusive fence. Old binaries can bypass application guards.
The witness must be separately governed and excluded from participant recovery;
joint rollback under the same uncontrolled controller is not safe. These are
explicit prerequisites, not satisfied by hashes, fixture signatures or a green
snapshot-retention test. Signed acceptance requires independent verification of
the decoded histories and exact stopped/drained recovery window.