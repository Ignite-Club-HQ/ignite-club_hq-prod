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
