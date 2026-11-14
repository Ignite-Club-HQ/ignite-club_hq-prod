# Test2 DEV event-notification delivery readback — draft security review

## What happened
On 14 Nov 2026, signed Test3 `notify_event_audience(event, "event_invite")` returned `Ok(1)` after checking the synthetic club roster (one club administrator, one parent and no children). This indicates one notification accepted for queueing; **not successful delivery to a phone**. Test2's RSVP remained `maybe`. No event auto reminder was enabled. The test club and event are under **Group 2 canisters on ICP mainnet** despite being accessed through the DEV frontend. The canonical Group 2 queue `zu4gk-vqaaa-aaaal-qxp5a-cai` is deliberately **not** advertised in DEV ICP MCP service discovery.

## Scope and security approach
This temporary two-hop diagnostic **does not publish the Group 2 queue** or alter the discoverability manifest. A signed query-like update against the already-discovered Group 2 `club_domain` canister `read_account_my_dev_test2_event_delivery(event_id)` returns only an optional `{status, attempts, created_at_ms}`.

- The club endpoint checks the **exact executing canister ID**, **exact signed Test2 principal**, **exact synthetic event ID**, current account admission, current parent role on the **exact synthetic team**, current club membership, no removal/transfer fence, and the **exact configured queue ID**.
- The queue endpoint `read_trusted_dev_test2_event_delivery(event_id, recipient)` checks its **exact executing queue ID**, the **configured club-domain caller**, the pinned Test2 recipient/event, and filters notification rows by **user + club + kind = event_invite + related_id**. Multiple matching rows cause a failure rather than an ambiguous answer.
- It emits **no** notification contents, user enumeration, message bodies, idempotency keys, device tokens, notification IDs, push provider details, or private membership rows.
- Both methods are read-only in their effects; they are Candid *update* methods only because the official ICP connector and the existing cross-canister authority pattern use authenticated updates.
- These hard-coded DEV test bounds are intentional, temporary and **must not be generalized as a customer feature without a new privacy and authorization review**. This code would have no effect on any canister without a later explicit deployment. Because the target G2 IDs are mainnet canisters, do **not** call a deployment to these canisters “isolated DEV”.

## Status semantics
`pending` = enqueued; `processing` = worker has claimed it; `failed` = worker marked terminal failure; `delivered` = queue worker/provider reported completion. **Delivered does not prove receipt, OS notification display, a push tap, or user reading it**. `Ok(null)` = no matching queue row currently available (this does not prove none ever existed, e.g. record removal). A worker's granular device receipts are intentionally not exposed.

## Automated validation and release controls

The owner has opted to proceed **without an external Motoko reviewer**. Code verification is performed with repository CI and disposable PocketIC integration, not an independent human sign-off. This choice does not turn a mainnet upgrade into a DEV-only action.

1. Build and typecheck `events_domain`, `club_domain` and `notification_queue` Motoko, and validate generated Candid/TypeScript drift.
2. Run both `scripts/dev-test2-notification-readback.test.mjs` and `scripts/event-invite-queue-authority.test.mjs`.
3. Run **both** three-canister isolated PocketIC suites: signed Test2 restricted Parent readback with a genuine locally created event invitation; forged labels/keys blocked on `enqueue` and `fan_out`; normal reminders and unrelated notification categories preserved. No live devices or mainnet canisters used.
4. Confirm **all GitHub Actions succeed on the final exact commit** before considering deployment.
5. **Separate explicit owner approval remains necessary** for any merge or Group 2 mainnet canister upgrades. Record the exact group/canisters, source SHA, ordering, upgrade/rollback procedure, and post-upgrade checks before that operation.

## Current branch CI evidence (14 Nov 2026)
- **PASS:** Node source-contract test (`scripts/dev-test2-notification-readback.test.mjs`)
- **PASS:** standalone notification_queue Motoko 1.16.1 compilation
- **PASS:** standalone club_domain Motoko 1.16.1 compilation
- **PASS:** disposable PocketIC authorization suite for the exact deployed-source pair, with **no internet/device push** (GitHub Actions isolated-permissions job)
- **PASS:** repository auth-release-policy and existing parent chat-sync tests
- **Additional broad frontend/onboarding jobs:** consult the latest commit's CI result; these are not substitutes for the above security gates
- **Still required:** final exact-commit CI verification and **separate explicit authorisation** before merge or Group 2 mainnet installation. No outside reviewer is being sought.

## Event-notification provenance: security fix integrated

This branch now includes the **tested trusted-caller policy** originally developed in draft PR #1514. The queue checks `event_invite` **and** the canonical `event_invite-` ID/key namespace at both the start and just before mutation in `enqueue` and `fan_out`. Only the configured `club_domain` canister may write that namespace. The Club canister independently validates its `events_domain` sender before forwarding event notices.

The isolated integration tests now seed the invitation through the **real Events → Club → Queue path**, not a fabricated caller or local fake queue row. The Test2-only readback is checked against that same notification record. This addresses forged event-invitation writes **after the code is deployed**, not historical untrusted rows.

A canonical key is **not retroactive cryptographic provenance**: a record created before the fix might have been spoofed. Do not assert that Test2 received the original 14 November notification on a device. `delivered` would still mean the worker/provider processed a notification, not OS display/read.

## Risk notes
All Group 2 canisters are mainnet services; even a “DEV” test read can touch that shared state. The one-notification enqueue is already complete and this PR does **not** trigger another. The deployment checklist must validate protection/fencing and queue wiring in the target environment. The branch and draft PR alone cannot confirm delivery to the device.
