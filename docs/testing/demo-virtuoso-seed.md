# Virtuoso demo chat seeding — execution notes

Scope is hardcoded to PROD club `9c5fa204-6cbe-49d5-a3d2-26b98b0419de` and exactly nine verified conversations.

1. Run the manual **Prepare Ignite Soccer Demo Virtuoso chat seed** workflow after merging the PR. Download the JSON artifact. The workflow is **preparation-only** and never sends messages.
2. Use a separately authorized, scoped test identity to run the sender. It needs to be the exact same authenticated principal that is a member of all nine threads. A random Ed25519 identity is **not** interchangeable with Paul's Internet Identity; no credentials are bundled or provisioned. If an appropriate credential is unavailable, stop rather than creating one or bypassing membership.
3. From the `frontend/` directory after installing dependencies, run:
   ```bash
   export IGNITE_DEMO_SEED_IDENTITY_FILE=/secure/path/ed25519-identity.json
   export IGNITE_DEMO_SEED_EXPECTED_PRINCIPAL=<exact-authorized-principal>
   export IGNITE_DEMO_SEED_CONFIRM='SEED 9c5fa204-6cbe-49d5-a3d2-26b98b0419de'
   node ../scripts/send-demo-virtuoso-seed.mjs /secure/path/ignite-demo-virtuoso-seed.json
   ```
4. Verify all nine conversation counts and Virtuoso scrolling in the app before considering the test complete.

**Limitations:** The sender has not been executed or integration-tested against PROD. It currently performs a send for every manifest entry rather than checking existing idempotency keys first; the canister's idempotency behavior must be verified before rerunning after interruption. No automatic retry is implemented, and a failed/ambiguous send stops execution. All sample messages are authored by the single authorized identity, not fabricated senders, and timestamps reflect send time rather than historical dates. Do not use this on real club conversations.


## Safety gate added 24 November 2026

The sender now requires all of: the exact 150-per-thread manifest, the nine hardcoded allowlisted conversation IDs, no duplicate idempotency keys, an explicit SHA-256 approval of the manifest file, `IGNITE_DEMO_SEED_EXECUTE=YES`, an exact expected caller principal, and the existing club-ownership checks. It refuses to execute under CI/GitHub Actions; never place production identity secrets in GitHub Actions. The workflow remains manifest-generation-only.

**Important blockers before any PROD execution:** (1) The available Internet Identity delegation is not an Ed25519 private key, so the existing sender is not an operational way to use Paul's connected ICP identity. (2) Confirm that the deployed canister's `read_account_read_conversation_club` proves current caller authorization, not merely metadata. (3) Confirm actual idempotency and how to reconcile an interrupted run; the current sender does not skip previously sent messages. (4) Run static/type checks and isolated mock tests for manifest tampering, wrong club, wrong identity, interrupted sends and replay. (5) Verify that a sender cannot bypass the club check via a forged manifest. Until these are complete, **do not execute the sender in PROD or merge as a ready-to-run seeding solution**.

The previous execution example must also set `IGNITE_DEMO_SEED_APPROVED_SHA256` to the SHA-256 of the exact manifest and `IGNITE_DEMO_SEED_EXECUTE=YES`. These flags are necessary, not sufficient, for safety.
