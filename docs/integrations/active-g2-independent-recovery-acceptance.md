# Active Group 2 reader — independent recovery acceptance

Status: **proposal and compilation tests only**. This is not an approved reader release.

## Verified existing enforcement

The existing signed production reader implementation has three distinct protections that must all survive adaptation to the currently accepting DEV Group 2 topology:

1. `production_account_authorization::validate` verifies an independent Ed25519 approval bound to an exact account-service identity, governor, generation, expiry, reviewed inventory and recovery evidence.
2. The separate `recovery_witness` canister maintains independently signed recovery and subject-removal baselines, checks program/controller identity, immutable participant module hashes and version counters, and refuses fenced subjects.
3. `identity_access.current_service_account` reconstructs the current active account after the last awaited call, rechecking alias denials, outstanding account deletion tickets, subject membership and account versions.

The existing signed production approval assumes a **closed two-group** inventory. The current mainnet DEV router reports only the **accepting** `g2` group. It cannot safely be reused without a separate, reviewed extension to both the approval and witness acceptance protocols.

## New proposal: versioned DEV G2-only signed acceptance

`active_g2_recovery_acceptance.rs` defines a limited, domain-separated signed scope:

- immutable DEV identity, router and Group 2 **club** principal;
- independent recovery-witness principal;
- pinned registry revision and strictly increasing authorisation generation;
- bounded expiry (at most 24 hours);
- independent recovery baseline digest and recovery epoch.

The new `SubjectChallenge` binds an independently witnessed result to the exact account ID, account version, subject principal, unique currently linked aliases, registry-independent history revision, removal generation, challenge nonce and signed scope digest.

**The new validator checks cryptographic scope and data shape only.** It does not yet attest that the recovery witness's separately controlled program is correct or that the subject-removal baseline has been signed and armed. A round-trip-shaped receipt is not proof of a witness call. It must never be used as sufficient evidence for identity reads.

## Required integrated work before activation

1. Independently review the signed acceptance body's full scope and implement governor-reviewed, replay-safe verification using a **pinned independent approver public key** (not one supplied by a browser or request).
2. Extend the independently controlled recovery witness with a domain-separated, signed, **live DEV G2 reader** approval and subject-recovery fence, without broadening or reusing a PROD-only closed-group approval. Enforce expiry, witness program/controller pins, immutable change-version, revocation, restored history and exact account/aliases.
3. Run a real two-canister test (identity_access plus recovery_witness), using a real Group 2-style club sender. Test active Test account, outsider, suspended account, erased account, removed alias, stale account version, replay, modified registry, replaced club principal, cancelled/disabled capability and upgrades.
4. Verify the installed G2 club's receiver settings and account authority. The current Test-identity read returned `Configured identity authority required` for the protected configuration; governor-only live readback is required. A mismatched release must **stop** rather than alter admission, deletion or routing.
5. Produce an immutable reviewed deployment manifest and an operator-signed approval of exactly the DEV identity, club, router and recovery-witness canisters. Perform controlled DEV-only upgrade with durable receipt, rollback proof and post-upgrade smoke test.
6. Only then consider changing `ACTIVE_G2_READER_INDEPENDENT_RECOVERY_APPROVED` from `false`. That flag is a **temporary hard stop, not an approval process**; build-time enabling alone is insufficient.

## Current release decision

**No live deployment, no authority grant and no Test account sync.** Work on the independent witness and admission receiver verification must be completed and reviewed first. Existing test club/team data should remain unchanged.

## 12 November follow-on: shared protocol foundation

The exact G2 `SignedScope`, `WitnessRequest`, `SubjectChallenge` and receipt-shape definitions now live in `backend/shared/active_g2_account_read_protocol.rs`, compiled into **both** `identity_access` and `recovery_witness`. This eliminates divergent Candid request types and runs the same negative tests in both Rust crates. The independent witness **does not yet expose a live G2 account-read method**; the new identity reader remains hard-disabled. Next work must implement and independently review an actual witness acceptance state machine, signed recovery-baseline arming, caller restrictions, current subject-removal fencing and revalidation after awaits. Never treat shared structs or receipt shape as proof of witness authority.

## Endpoint implementation (12 November 2026)

The draft now contains `recovery_witness.authorize_active_g2_subject_reader`, `disable_active_g2_subject_reader`, and `verify_active_g2_subject_read_fence`, together with a guarded identity-side `read_active_g2_linked_account` call. It uses the shared Candid protocol in both Rust canisters.

The witness reuses **independent signed subject-removal acceptance**, validates its current accepted baseline and digest, checks signer, G2-only identity/witness pins, expiry and generation, requires arming against current management lifecycle, and rechecks immutable account-removal/denied-subject maps and participant module/version evidence after awaits. It writes a stable replay journal only after successful verification. Subject checks return the exact challenge, never a browser-supplied account object.

The identity service constructs its request from `current_service_account`, checks the pinned witness program/controller before and after the call, and rejects history, account version, aliases, deletion or authorisation drift before returning. The signed scope is required in the governor-only authorisation method rather than deriving rights from admission alone.

### Deployment blockers deliberately retained

- `ACTIVE_G2_READER_INDEPENDENT_RECOVERY_APPROVED=false` remains the unconditional hard stop. Neither authorisation nor a read can use the new path.
- The independently controlled witness has not been provisioned with a reviewed current DEV baseline and signed G2 reader acceptance; `IGNITE_RECOVERY_APPROVER_PUBLIC_KEY` and existing witness canister/controller/module pins must be configured and independently reviewed.
- Two-canister test against DEV-shaped replicas with genuine authentication, revoked principal, suspended/erased account, account changes during awaits, changed router, upgrade/re-arm, nonce replay and altered witness program/controller is required.
- The nonce journal currently has a bounded fail-closed capacity. Before opening beyond the pilot, review capacity and replay retention policy; never auto-evict old nonces without a secure epoch transition.
- The DEV Group 2 receiver must attest admission-only mode through the governor-authorised configuration read; any unknown or mismatched setting is a stop.
- The existing repository-policy CI allowlist mismatch (PROD push rollout workflow) is separate and still must be resolved through its normal review.

No release is authorised from this draft. No canisters or customer records have been changed.
