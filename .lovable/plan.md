# Fast native ICP push notifications

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