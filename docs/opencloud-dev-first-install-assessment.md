# OpenCloud DEV: fresh installation versus recovery

Assessment only — 25 November 2026. No application code, deployment settings, workflows, controllers or live environments changed. Witness installation is paused.

## Conclusion

**A genuinely fresh DEV installation does not inherently need an independent recovery witness or a separate approver signing key to start ordinary application use.** It needs authenticated installation, verified environment-specific service identities, complete inventory, encryption wiring and secure admission commissioning.

**The present Ignite commissioning path does require both.** The recent OpenCloud preparation reused the signed recovery-oriented inventory bootstrap. That is a code dependency, not proof that a new empty environment has recovery work to perform. My earlier statement that a dedicated witness was necessarily required for fresh DEV was too broad.

Recommendation: implement a narrow **OpenCloud DEV first-installation path**, reuse the existing admission-only protocol, and keep account-wide destructive operations and recovery disabled. Do not install the empty witness merely to satisfy the current bootstrap dependency. Keep the already-generated encrypted signing key and built witness artifact dormant; no new credential is needed for this proposal.

This is a feasible source-level design, **not an already-supported or live-verified alternative**. Simply omitting the witness from today's package will leave commissioning blocked.

## Why the current path asks for recovery evidence

In `backend/identity_access/src/lib.rs`:

1. `provision_production_account_inventory` verifies an independent signature, collects the complete closed inventory and management lifecycle evidence, then calls `check_production_witness` before storing the trusted registry and supplemental pins.
2. `authorize_production_member_access` requires that registry pin. It does not itself request the independent signature or witness, but cannot run before the preceding provisioning step.
3. Engine private-name sources are admitted through the commissioned ordinary member-reader inventory. They therefore inherit the bootstrap dependency indirectly.
4. Membership-directory configuration also requires the previously pinned registry.

The witness protects against a different problem: **restoring old snapshots after account removal or revocation**, including restoring several cooperating services together. It retains independent removal/progress records and independently accepted lifecycle state so that restored local state cannot silently resurrect authority. The separate signer approves that privileged recovery/protection state independently of the deployment operator.

There are no pre-existing removal records to recover in a genuinely new environment. Asking that environment to enter the recovery protocol first conflates establishing initial trust with recovering historical trust.

However, “no existing data” is an installation fact to verify, not a reusable permission to bypass safeguards. After people start using DEV, there will be account and permission state worth protecting. A first-install path must never become a reset or recovery endpoint.

## What can be reused

| Existing implementation | Proposed reuse |
|---|---|
| Governor supplied in authenticated installation arguments | Existing DEV developer identity performs commissioning; no first-caller takeover |
| Complete inventory validators and closed-group review | Exact shared services, independent `base` and `g2`, media stores and supplemental authorities remain mandatory |
| Repeated registry reads and management lifecycle checks | Validate installed modules and unchanged environment throughout commissioning |
| `authorize_production_member_access` | Existing 24-reader admission-only authorization; verify each receiver's actual installed configuration |
| `member_reader_access`, current account/alias checks and pending-work checks | Ordinary access remains permission checked and fail closed |
| Membership-directory inventory/lifecycle checks | Register both new club authorities without inventing legacy mainnet ownership |
| Secure own-name save and engine private-name source checks | Keep operator-pinned PII authority, stored-ciphertext verification and final permission checks |
| `deferred_account_operations_clear` and existing recovery protocol | Ordinary access does not acquire global erasure/recovery authority; existing signed recovery remains separate |

The existing generic inventory setters are not a shortcut: they use rehearsal authorization. Enabling rehearsal, widening allowlists or supplying fabricated recovery evidence would be the wrong solution.

## Smallest secure first-installation design

### 1. Bind it to this installation, not merely to “an engine”

Use an explicit DEV-only installation binding: exact identity, governor, router, service inventory, host/network/deployment and reviewed modules. Require `opencloud-dev`, not a generic OpenCloud flag. Reject mainnet, OpenCloud PROD, reused service IDs and conflicting prior pins.

The current shared engine-scope helper accepts both engine deployment labels; it is not sufficient by itself to authorize the new DEV-only entry point. The new path must independently enforce the exact DEV binding without changing PROD behavior.

### 2. Establish freshness while everything is closed

Owner/ChatGPT verify that installation used empty canisters in install mode, with no restored snapshots or imported data, and record authenticated module/controller/lifecycle evidence. Then the governor commissions the reviewed installation while both groups reject new clubs.

Require a one-use first-install marker established by initialization, no prior commissioning/protection receipt, no unexpected user data, no existing or pending removal/link/recovery work and no conflicting authority configuration. Validate relevant domain/media state as well as identity state; checking a single empty account table is insufficient.

**Do not require literally zero accounts or zero lifecycle/history counters.** Identity initialization creates the governor account, and legitimate installation/wiring advances counters. The admissible initial state must explicitly account for those expected records and operations.

An initialization marker in stable memory alone cannot prove freshness after restore. Bind it to externally checked management installation history and current lifecycle counts. Unsupported or ambiguous engine readback must stop commissioning.

### 3. Commit ordinary-access pins, not recovery approval

Reuse the full candidate inventory collector and validators, but store a distinct first-install commissioning receipt rather than a fabricated `SignedApproval`. Repeat closed-state, module, lifecycle, inventory, governor and pending-work checks across awaits, then commit synchronously. Identical retry must be read-back/idempotent; a conflicting request must be rejected.

After pinning, use the existing admission-only receiver checks and member-reader commissioning, then configure the membership directory. Keep the witness acceptance cells, signed recovery receipts and removal capabilities untouched. Avoid a general “skip witness” switch.

### 4. Preserve encryption

Keep the existing chain-key proxy and SDK derivation, the exact group PII identities and reciprocal club/PII authorization. Pin the fresh Group 1 own-name authority; activate only the existing encrypted-save and authorized club-name releases after their configuration is verified.

No plaintext fallback, no imported encrypted names, no re-encryption, no browser-selected authority and no weakening of club-staff/member checks. Recovery approver keys are not encryption keys: removing their fresh-bootstrap dependency does not change the encryption derivation.

### 5. Never let it become a recovery bypass

Consume the initial commissioning permission permanently for ordinary operation. Retain current denials, alias restrictions, pending-work barriers and membership checks. Keep global account erasure/recovery and any other witness-dependent operation unavailable.

Bind fresh-mode access to management lifecycle evidence so a restored commissioning receipt cannot reopen permissions after later use. Ordinary updates must not be mistaken for restores: use management change history/counts, not `canister_version`.

An upgrade, snapshot load or uncertain lifecycle change must close the affected fresh-mode authority until a separately reviewed lifecycle procedure completes; it must not rerun initial provisioning or reset history. This requires explicit tests and a defined reviewed-upgrade path before release, not an assumption that the empty starting point protects future data.

If recovery or account-wide destructive capabilities are later required, commission the existing independent witness and signing protocol separately. If DEV is intentionally discarded instead, a separately authorized new installation can start fresh; this assessment does not authorize deleting or reinstalling anything.

## What still genuinely needs external verification

- ChatGPT/owner: verify the complete new DEV inventory, installed/empty state, effective controller bindings and internal governors. Controller evidence for the frontend alone does not prove backend installation authority.
- ChatGPT/owner: establish that OpenCloud exposes trustworthy management installation/lifecycle evidence, including snapshot-load changes, with the semantics the existing guards require. If that cannot be established, a local empty-state flag is not an acceptable replacement; the proposed path cannot be released as restore-safe.
- ChatGPT/owner: verify the supported authenticated installation and frontend-upload transports, then perform fresh DEV sign-in, club creation and authorized/denied encrypted-name/media readback after implementation.
- Paul: choose whether the first DEV release may keep global account erasure and recovery unavailable. That limitation is what allows their independent witness/signing infrastructure to be deferred without granting those capabilities unsafely.

**No additional public key, credential or canister is requested for this design.** Reuse the existing separate DEV governor and website publisher. The already-created empty witness and encrypted approver key can remain unused, without deleting them or changing their controllers.

## Implementation scope, if approved later

- A narrow DEV-only first-install commissioning entry point and distinct receipt/state, with initial-state and lifecycle checks.
- Reuse existing closed inventory, admission, directory and encrypted-name implementations; add only the checks needed to separate first-install from recovery.
- Update the isolated DEV packaging/build prerequisites so ordinary first-install artifacts do not require witness/key pins; existing mainnet/PROD and recovery artifacts retain their pins and checks.
- Focused tests for wrong environment/caller, nonfresh or restored state, partial inventory, drift across awaits, conflicting retry, denied encrypted disclosure and unchanged recovery/PROD rejection behavior.

No code changes, WASM rebuild, installation, controller changes, workflow dispatch, Supabase/email operation or PROD activation were performed in this assessment.