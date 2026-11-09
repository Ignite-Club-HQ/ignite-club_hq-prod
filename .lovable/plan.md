# Fast native ICP push notifications

## Additional option: run the sender on ICP itself
**Plain-English proposal:** Ignite creates an alert, an ICP-hosted sender immediately sends it to Firebase, and Firebase delivers it to Android/iPhone. No Render account and no GitHub delivery schedule. **Firebase must remain**: ICP alone cannot deliver operating-system push notifications to these phones.

This is an alternative to the hosting plan below, not an approved replacement. **Start with a small TEST feasibility check**, because safely authorizing Firebase from ICP is the main unresolved issue. Do not upload the existing Firebase private key into ordinary canister storage.

### What we would build
1. Reuse the existing ICP notification records, native device registrations and audience checks. Add one dedicated ICP sender that wakes when an authorized alert is queued; enqueueing and Home/chat/event actions must not wait for Firebase delivery. Use a short recovery timer for pending work, not constant empty polling or GitHub runners.
2. Have that sender contact Firebase directly, using ICP's **single-request HTTPS mode**. The default mode sends from multiple replicas and could produce multiple phone alerts; it must not be used for sending pushes.
3. Keep existing membership, preferences, chat mute and current-device checks immediately before delivery. Use bounded batches and the existing source queues/device directory rather than copying registrations or building another notification database. Use generic lock-screen content and authorized destinations.
4. Keep one durable attempt per notification/device. If Firebase may have accepted a send but its response was lost, hold that attempt instead of automatically resending it. Recreate wake timers after upgrade without blanket queue recovery; never run the GitHub sender and ICP sender concurrently.

### First resolve Firebase authorization
The current Firebase sender uses a private RSA service-account key. Ordinary ICP canister storage is visible to the executing replicas; making a field private does not securely hide that key. ICP's threshold ECDSA signing is not a drop-in replacement for Google's required RS256 service-account signing.

- Verify a **keyless Google identity-federation route backed by ICP-verifiable identity**, or a supported **confidential/TEE ICP deployment** with suitable credential protection. Neither is established for this app today; each needs actual availability, security and authentication proof before implementation is approved.
- Use only a separately approved, narrowly scoped TEST credential if a protected route is proven. Do not copy the existing live Firebase secret, invent a custom cryptographic signer, or use a token-refresh server while calling the result “ICP-only.”
- If neither route works safely, stop and report that direct ICP-only sending is not ready; retain the external-worker plan rather than weaken key protection. Do not deploy an ordinary key-holding canister as a shortcut.

### Speed and cost
**Goal:** the same seconds-scale experience as the hosting option—roughly 3–8 seconds in normal conditions, with 95% within 10 seconds on TEST. These remain unmeasured targets, not a claim that ICP will meet them. Immediate wake-up removes scheduled waiting; consensus, authorization, HTTPS, OAuth refresh and phone restrictions still take time.

There is **no Render hosting bill**, but this is not free: ICP execution, storage and HTTPS requests consume cycles. Protected-subnet pricing/availability may add constraints. Measure cost per delivered alert and idle cost on TEST; present a monthly estimate for expected volume before any paid provisioning. Cache short-lived Firebase authorization securely to avoid an extra token exchange for every alert.

### TEST proof and release
- First prove protected authorization and single-request transport on isolated TEST infrastructure, without changing the working app's live credentials or sender.
- Then measure at least 30 real queued native alerts, including Android/iOS foreground, background and closed-app receipt and taps. Include denial/mute changes, account switching, multiple devices, OAuth expiry, upgrades, low cycles and lost-response cases. Report end-to-end median/P95, failures, duplicates and cycles—not merely Firebase acceptance.
- A default replicated POST is not acceptable, and FCM supplies no documented exactly-once send contract. Single-request mode avoids replica fan-out but trusts one replica's response; no automatic retry after ambiguous acceptance means an alert may be missed rather than duplicated. Make that tradeoff explicit.
- After TEST success and Paul's approval, hand over the exact reviewed PROD queue inventory with sending limited to Paul first. Do not implicitly approve extra subnets, move encrypted-media clubs, change group placement or activate sending to other users. Supabase/email behavior stays unchanged.

**Decision point:** choose between the proven external worker and ICP-hosted delivery only after the credential feasibility check, measured speed and cost are available. This plan authorizes scoping, not deployment, credentials, charges or live activation.

References: [ICP HTTPS modes and credential risks](https://docs.internetcomputer.org/concepts/https-outcalls/), [ICP HTTPS security](https://docs.internetcomputer.org/guides/security/https-outcalls/), [Firebase sender authorization](https://firebase.google.com/docs/cloud-messaging/auth-server), [Google service-account signing](https://developers.google.com/identity/protocols/oauth2/service-account).

## Recommended approach
Replace GitHub's five-minute delivery schedule with **one continuously running, paid background worker**. Reuse the existing ICP notification queue, registered Android/iOS devices and Firebase delivery. GitHub remains for deployments and manual diagnostics, not routine notification delivery.

**Target:** normal alerts reach an online phone in roughly **3–8 seconds**, with a TEST acceptance goal of **95% within 10 seconds**. These are targets, not measurements or guarantees. Offline devices, operating-system restrictions, outages and queued load can delay delivery. The direct Firebase test proved phone reception only.

The current schedule alone adds 0–5 minutes before GitHub startup. My earlier 5–15 minute estimate was approximate, not measured.

## Smallest useful scope
1. Extract the existing one-shot sender into a reusable bounded processing cycle. Keep the signed ICP identity, source-queue authorization, current account/device restrictions and Firebase credentials server-side. Reuse connections and Firebase access tokens instead of starting fresh per run.
2. Add a small **worker-only pending-work query** to each approved queue. It provides only a bounded ready-work hint; it cannot claim notifications, expose contents or authorize sending. Poll that hint every two seconds while idle; drain ready work immediately through the existing consensus claim and authorization path. A stale hint can delay work, never grant access.
3. Run one non-sleeping background worker, initially on TEST. Render Background Worker is the proposed hosting service because it explicitly supports continuously running queue consumers. No new notification database or queue migration.
4. Before handover, verify exclusive worker ownership and safe restart behavior. Do not run the old GitHub sender simultaneously, call blanket recovery on every poll/start, or automatically resend a notification whose Firebase acceptance is uncertain. Reuse the existing attempt/fencing work where needed rather than adding a second recovery system.
5. Verify current device ownership, preferences, chat mutes and membership immediately before sending. Keep lock-screen content free of plaintext private messages. Test notification taps against real queued alerts, not just the self-test.

## Hosting and running cost
- Paid always-on compute is required; Render's exact current price remains unverified. Approve the selected plan before provisioning or incurring charges.
- Two-second polling is up to **43,200 lightweight checks per day per queue**. Do not make empty consensus claim/recovery calls at that rate. Measure queue-query load and cycle usage on TEST before selecting the final interval.
- If measured latency or polling cost misses the goal, use an authenticated wake-on-enqueue signal to the same worker. That is a separate, small backend extension, not part of the first rollout; ICP remains authoritative and no send depends on the recipient opening the app.

## Verification and release
- Build and rehearse on DEV/TEST first; no live notifications change during scoping.
- Measure at least 30 real native alerts from message/event action through queue creation, detection, authorization, Firebase acceptance and phone display. Report median, P95, errors and any duplicates; distinguish Firebase acceptance from display.
- Include Android and iOS foreground/background/closed-app cases, muted chats, denied membership, account switching, invalid tokens and restart-after-send behavior. Verify existing Supabase notifications remain unchanged.
- Production starts **Paul-only**, after explicit approval and TEST evidence. Confirm the exact approved queue inventory: existing PROD validation covers the base queue only, not every club group. Extend coverage only after verifying each group's queue/worker wiring; do not claim all-club delivery before that.
- Broader recipient activation needs Paul's separate approval. No Supabase/email delivery, Internet Identity origins, native plugins, or unrelated live settings change.

## Why not the alternatives?
- **Faster GitHub scheduling:** still has runner startup/scheduling delays and is not a seconds-scale delivery service.
- **Permanent Supabase Edge Function loop:** workers have finite lifetimes (150 seconds free / 400 seconds paid); not suitable for an always-on loop.
- **Wake-on-enqueue through a dedicated endpoint:** viable for later event-driven delivery, but requires a new authenticated outbound notification hook. The persistent worker plus a cheap queue signal is the smaller first implementation using today's queue.

References: [Render workers](https://render.com/docs/background-workers), [Supabase limits](https://supabase.com/docs/guides/functions/limits).

## Not included
Browser/web push, notification-data migration, multiple competing workers, general PROD activation, or a promise that every device always receives instantly.