# ICP-owned native notifications with Supabase transport

## Scope chosen by Paul, 05:35 UTC

ICP keeps accounts, registrations, preferences, audience/mute checks, inbox/queue records and durable send receipts. Supabase only holds its private worker identity, linked Firebase credentials and transient authorized send envelopes. No Supabase notification tables, email handlers, browser-push work or production delivery changes.

## Implemented, not activated

- Added a default-unconfigured, TEST-base-only native worker handover to notification_queue. Once explicitly commissioned, on-chain handover refuses legacy claim/recover, preventing that worker from replaying uncertain native attempts.
- Added reserve_native_push/settle_native_push: current ICP authorization, source lease, unchanged device snapshot, native-only device selection and durable receipts. Duplicate notification/token attempts remain occupied even after resume changes device timestamps. Unknown sends are held, never automatically replayed.
- Added queue-only messaging read_native_push_access, checking current chat access and mute state. Existing messaging authorization methods are unchanged.
- Added isolated Supabase transport orchestration and ICP authority adapter. No public endpoint, schedule, local journal or Supabase data access. Transient provider failures are deliberately held on ICP in this first candidate; automated retry/wake is not implemented yet.
- Created an app-owned dedicated TEST signing secret because the old TEST worker seed is absent from both repository and commissioning-environment secret-name inventories. No secret values exposed, no existing Firebase/production key changed. Sender principal still needs governor commissioning.
- Regenerated both client contract trees for notification_queue and messaging_domain; 17 active-contract drift checks pass.

## Checks

- Existing Firebase credential path: HTTP 200, outcome verified; no notification sent.
- notification_queue and messaging_domain compile with pinned moc 1.16.1 and existing dependencies. Native receipt-policy interpreter assertions pass.
- Supabase authority/delivery/signing modules pass Deno check.
- Focused frontend delivery/isolation tests pass; final count recorded in roadmap.
- These are local protocol/transport checks, not full replica race/upgrade tests, hosted deployment or phone acceptance. Existing push-manager mocks emit known diagnostic warnings while assertions pass; no runtime conclusion follows from those warnings.

## Remaining work before activation

1. Complete bounded nonblocking server-side wake and ICP-owned recovery/retry. Wake is only a hint; final authorization stays in ICP. Do not put Firebase, Supabase service-role or gateway credentials into ICP outcalls.
2. Complete installation identity/generation ownership (current candidate binds exact token/timestamp and refuses ambiguous cross-owner tokens, but does not implement stable installation IDs or token-rotation lineage). Verify removal/erasure and snapshot handling for added receipts; do not enable this candidate ahead of those checks.
3. Run real replica concurrency, lost-reserve/lost-settle, upgrade preservation and authority-change tests. Native reservation scanning is bounded/rotating; journal cap refuses before saturation instead of deleting uncertain records.
4. Securely derive the dedicated worker principal and obtain governor configuration/readback on exact DEV base queue. Only after complete protocol checks and exclusive handover add the private hosted endpoint. Do not grant ordinary legacy worker permissions as a shortcut.
5. Verify registered native TEST device, queued inbox readback, actual Android/iOS display/tap and enqueue-to-display timings. Paul's installed PROD Android app is not a TEST acceptance device; no production send is authorized by this request.

## Current limits

This candidate is base TEST queue only, not both TEST groups. Multi-group rollout must use the existing explicit queue inventory rather than guessed fallbacks. No endpoint deployed or sender enabled; no near-immediate performance claim or end-to-end push success.