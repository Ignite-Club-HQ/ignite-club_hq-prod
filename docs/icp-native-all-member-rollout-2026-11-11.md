# Native ICP push rollout status

## Implemented preparation
- Separate governor action binds activation to the commissioned worker. Upgrades default to the existing pilot restriction; activation is not automatic.
- Persisted activation boundary excludes old pending alerts while preserving inbox records. New alerts older than thirty minutes are not sent.
- A bounded sender drains successive ten-send batches instead of stopping after the first ten.
- Completed successful/inactive receipts compact only when their known source is terminal and expired. Sending, held, rejected and missing-source evidence is retained; duplicate suppression remains for eligible sources. Capacity holds now concern unresolved work, not lifetime successful sends.
- Settlement marks completed sources terminal immediately and requests a queue wake for remaining devices.
- Existing foreground presentation, phone linking, Supabase/email push and native payload conventions are unchanged.

## Checks
Motoko policies, canister compilation, generated contracts and focused frontend tests pass. The existing TEST lifecycle workflow now includes disposable LIVE-address ordinary-member activation, upgrade persistence, backlog, expiry and event-preference checks. These are prepared tests, not executed replica evidence.

## Release blockers
1. The sandbox's write-fault metadata is incompatible with PocketIC; its required preflight refuses. Run the existing `[TEST] Verify disposable native push lifecycle` workflow on a native Linux runner for real-canister evidence.
2. Normal chat/event membership and mute checks need native-path real-canister acceptance, not just the successful self-test or legacy worker tests.
3. Complete PROD active-group inventory is unavailable in this checkout (PROD mapping absent). Current fast sender accepts only the fixed base queue; independent group queues have no fast-native handover or account-bound shared-directory composition. Do not widen to all groups by changing a queue allowlist or redirecting group traffic to base.
4. Live iPhone acceptance is unverified; the supplied screenshot establishes Android only.
5. No governor or GitHub credentials are available in this sandbox to run protected rehearsals, confirm exact-source release jobs or activate PROD. No PROD changes were made.

## Important
The all-member flag is intentionally not enabled. Successful local tests do not meet the approved release conditions. The protected release must include the statistics lookup repair, exact active-group coverage and phone acceptance before claiming all-user delivery.