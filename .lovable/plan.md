# Enable native push for all ICP members

## Current position
Your phone test proves foreground and background delivery. It does not yet prove ordinary chat/event alerts, delivery across independent groups, or sustained delivery to everyone.

The live service currently admits only your account. Do not simply remove that restriction: old pending alerts could reach other phones, and the current sender has limits that could delay or eventually stop delivery.

## Changes
1. Keep the working sender, phone presentation and email-mode notifications unchanged. Android/iPhone only; no browser push.
2. Prove ordinary-member chat and event alerts, notification preferences, muted chats, removed membership, sign-out/account switching and notification taps in TEST/rehearsal. Check iPhone delivery separately if your completed phone test was Android-only.
3. Add an on-chain activation boundary so previously accumulated alerts are not broadcast when access widens. Preserve inbox history; do not bulk-delete alerts.
4. Make the bounded sender continue promptly when more than ten deliveries remain, without replaying uncertain sends. Address the current lifetime 10,000-attempt stop with safe receipt retention that preserves duplicate suppression.
5. Verify delivery for every active ICP group. The existing fast sender handles only the base queue; group queues must retain their own authorization and use the current account-bound device directory. Do not silently redirect group traffic to the base queue.
6. After these checks pass, widen the approved live recipient policy to all eligible ICP members, retaining permission and preference checks. Release the statistics-access repair alongside this work.

## Acceptance
- Ordinary members receive authorized new alerts promptly with the app open or closed.
- Muted/disabled alerts and revoked chat or club access do not deliver.
- No old-alert flood, cross-account delivery or uncertain-send replay.
- Bursts exceeding ten deliveries drain, and sustained use does not stop at 10,000 historical attempts.
- Existing email-mode push remains unchanged.

## Technical boundaries
ICP retains registrations, recipients, authorization, queue state and delivery receipts. The existing isolated Supabase sender retains only Firebase authorization and transient delivery transport. Reuse existing release workflows and credentials; do not enable the legacy scheduled worker or rotate keys.

## Release
Prepare and test first, then activate through the protected PROD release path after exact-source release checks. Actual phone acceptance and supported active-group coverage must be recorded before claiming all-user delivery is enabled.