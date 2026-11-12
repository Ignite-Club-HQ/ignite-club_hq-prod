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

## Isolated integration result — 12 November 2026

- GitHub Actions run [43134626547](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/43134626547) passed the `g2-witness-isolated` job and the `rust-canisters` job.
- Disposable native Linux PocketIC installed the exact DEV identity pin and independent witness WASM, ephemeral test signer, signed/armed subject baseline, and a signed G2 scope. The report is in the `g2-witness-isolated` Actions artifact.
- The witness accepted one properly signed, fresh account challenge from the simulated pinned identity principal and rejected replay, wrong caller, malformed subject/alias, invalid scope and zero nonce. Independent removal journaling and upgrade-fencing checks also completed.
- During test iteration, a real first-time account compatibility bug was found: `identity_access.register_account()` creates version **0**, which the initial G2 validator refused. Both the challenge and receipt validators now accept that valid initial version while preserving exact identity-owned account-version comparisons. Rust and PocketIC regression tests cover it.
- The earlier PocketIC failure was an omitted disposable management-lifecycle probe; the CI job now compiles that pinned Motoko probe.
- **Not yet tested:** the real, positive `club_domain -> identity_access.read_linked_account -> recovery_witness` inter-canister path. The present witness positive test uses a PocketIC sender set to the pinned identity principal. It must not be represented as a true canister-originated identity call. `ACTIVE_G2_READER_INDEPENDENT_RECOVERY_APPROVED=false` still prevents the identity-side reader from running.
- **Not yet established:** suspended/erased account handling over the entire chain, in-flight account modification, live DEV receiver configuration/governor pins, and safe independent commissioning/upgrade. No deployment was attempted.
- The repository's separate `auth-release-policy` CI job fails because the production workflow allowlist in `scripts/workflow-env-names.test.mjs` does not include an existing production rollout workflow. Do not broaden production workflow permission checks without a separate review.

This is successful **isolated witness integration**, not a completed end-to-end onboarding, production authorisation, or permission to merge/deploy.

## Genuine three-canister isolated acceptance (12 Nov 2026)

- A **feature-gated, separately compiled** `identity_access` WASM and disposable Motoko `g2ChainProbe.mo` now exercise a real `club-side canister -> identity_access.read_linked_account -> recovery_witness.verify_active_g2_subject_read_fence` call. The probe uses a pinned Group 2 canister ID in a **local PocketIC replica** and runs with a signed-in user; it is not the full deployed `club_domain`.
- CI run [43136956139](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/43136956139) reported **success** for isolated G2 witness tests and Rust security tests; the frontend was still running and unrelated repository-policy allowlist failed at observation. The test accepted a legitimate version-zero new account and rejected a distinct unregistered human.
- Additional regression tests now reject the same club path after an independent account-removal record, plus a direct browser caller impersonating the G2 club. These additions need fresh CI confirmation.
- **Production identity reader stays hard-disabled:** `ACTIVE_G2_READER_INDEPENDENT_RECOVERY_APPROVED=false` and the standard build excludes `isolated-g2-chain-fixture`. The test fixture compiles only with `--features isolated-g2-chain-fixture` and `IGNITE_ISOLATED_G2_FIXTURE_BUILD=POCKETIC_ONLY_NOT_DEPLOYABLE`. Never pass either flag to any deploy/promotion workflow.
- The fixture bypasses live router/receiver commissioning on purpose. It validates account identity and witness transport, **not** safe approval of live routing, signed inventory, governors, receiver admission, or ordinary release. No mainnet canisters or user data were changed.

**Next:** independently review the feature-gated fixture's exclusion from every deployment/build path; run the actual Group 2 `club_domain.sync_my_linked_account` against a disposable reviewed receiver configuration; test suspended/erased account and concurrent unlink/removal while awaited calls are pending; separately fix unrelated workflow allowlist through production security review. Do not activate the new production reader until all gates are met.

## Actual Club Domain isolated onboarding acceptance — 12 November 2026

- [GitHub Actions run #43138093239](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/43138093239) passed the `g2-witness-isolated` job with **the real Motoko `backend/club_domain/src/main.mo` compiled using enhanced migration checks**; Rust canister tests also passed, and the frontend build was completing in the observed run.
- Unlike the prior test-only `g2ChainProbe.mo`, this fixture installs the **actual Club Domain implementation** at the reviewed DEV G2 club principal in a separate PocketIC instance. The club is bound to the shared identity using its existing governor-only `link_display_identity_authority` method, with neither rehearsal admission nor account removal flags enabled.
- The test checks `read_account_whoami()` initially reports `Unlinked identity`, then runs the real `sync_my_linked_account()` as a newly registered principal (account version 0), verifies that `read_account_whoami()` returns the same account ID/version/principal list, and verifies that an existing club membership survives account synchronization.
- Invalid foreign-account linking and re-linking after an independent removal record are rejected. The test-only identity fixture still bypasses the production reader's live router/receiver **commissioning**, not the independent signed witness validation. It remains feature-gated, requires an exact build-time test marker, and is absent from default release builds.
- This is a genuine real-Club-Domain to identity to recovery-witness cross-canister sequence **in an isolated replica**, **not** an authorised DEV mainnet deployment, and does not prove the currently installed DEV G2 service configuration is releasable.

**Outstanding before any release:** verify suspended/erased account and asynchronous state races in the actual club path; confirm no fixture feature/marker can reach production build or deployment workflows; independently review recovery-witness signer/controller/module hash and actual DEV registry/receiver configuration; resolve the separate repository-policy CI failure with a reviewed allowlist change. Then produce signed, reversible DEV-only commissioning plan, and finally check the real Test identity, club and team. No live changes were made.
