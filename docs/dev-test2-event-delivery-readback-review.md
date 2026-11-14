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

## Review/test gates
1. Run `node --test scripts/dev-test2-notification-readback.test.mjs` (static source-contract tests). Tests confirm both actor identities, exact caller/event/team pins, absence of queue discoverability, no wide list or sensitive response fields, and read-only method bodies.
2. Compile both Motoko canisters and validate their Candid declarations against generated DID before any deployment; the Node checks are **not** a substitute.
3. Run **isolated PocketIC** positive and negative tests: exact Test2 status; unrelated identities, other teams/events, impersonation, changed/revoked Parent role, unfenced/fenced accounts, wrong queue wiring, wrong canister identity, zero and duplicate matching rows, and no data leakage. No private token or unrelated user may appear in replies.
4. Require human security review. **Do not merge, deploy to G2, enable new discoverability, or send any additional notifications** without separate explicit authorization. Only after an approved G2 deployment and the above tests should Test2 run the caller-scoped readback.

## Risk notes
All Group 2 canisters are mainnet services; even a “DEV” test read can touch that shared state. The one-notification enqueue is already complete and this PR does **not** trigger another. The reviewer must validate protection/fencing and queue wiring in the target environment. The branch and draft PR alone cannot confirm delivery to the device.
