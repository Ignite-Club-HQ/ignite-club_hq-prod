# Existing PROD base group — closed registration

This is one part of DEV-equivalent PROD setup, not full completion. It retains all 18 existing canisters and registers their group/placement metadata. It cannot fund, install, upgrade, enable lifecycle flags, pin identity, open groups, publish or touch the database.

## First owner run

After promoting the new tooling through the REPO workflow, run **[PROD] Prepare and register base group (closed)** in the live repository:

- Branch: **prod**
- Action: **plan**
- Reviewed-plan hash and confirmation: leave empty
- Keep budget defaults: 100 clubs, 1T minimum cycles, 3 GiB heap ceiling. These are closed-group limits, not deposits or permission to accept clubs.

The plan reads certified modules, sole controllers and subnets for all 18 existing canisters, plus the empty bounded consensus router registry. It records a hash-bound plan on the separate `prod-group-setup-receipts` branch, printing the hash in the log and Summary. No canister settings are changed.

Send the plan summary/evidence for review before choosing registration. Do not make another payment.

## After exact plan review

Run the same workflow from the same source commit with:

- Action: **register-closed**
- Reviewed-plan hash: exact hash from the successful reviewed plan
- Confirmation: **REGISTER PROD BASE CLOSED**
- Identical budget values

The runner verifies current modules/controllers/subnets and both revisions still match the reviewed plan. Each intent is persisted and read back at GitHub's acknowledged commit before the corresponding canister call. Registration uses revision compare-and-swap and final consensus readback verifies exactly one CLOSED base group and its complete independent PROD placement.

Registration does not require the identity lifecycle release. That release and identity/router pins remain prerequisites for later group readiness/opening, not excuses to block closed infrastructure metadata or bypass lifecycle gates.

## Stop and reconciliation

Any pending intent, unknown response, journal error, changed evidence, nonempty registry or incomplete placement stops the runner. It never blindly retries a canister call or replaces group endpoints. Keep the receipt branch. If a call succeeded but its reply was lost, review the exact receipt and signed registry reads before authorizing a separate reconciliation; do not rerun registration to guess.

No ephemeral-runner local lock is treated as durable: the protected production environment and shared deployment concurrency serialize normal execution, and the remotely persisted pending receipt blocks subsequent runs after interruption. Unknown receipt writes themselves stop before the next external operation.

## Still separate

- Supported identity/deletion lifecycle release and exact PROD trust bindings.
- Independent PROD g2 creation/configuration with reviewed fuel shortfall, fresh IDs and media derivation.
- Full service settings, module/key/removal-wiring acceptance and configuration-bound routing approval.
- Explicit admission opening and later app release, with DEV remaining separate.

The signing key stays in GitHub's temporary protected runner and is removed on exit; receipts/artifacts contain only infrastructure evidence, never key material or management environments.