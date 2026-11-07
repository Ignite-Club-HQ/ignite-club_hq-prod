# DEV ICP native push — isolation assessment

Assessment at 18:00 UTC, 7 November 2026. **Implementation held at the shared-dependency boundary required by the owner.** No runtime code, canister, Supabase, native configuration, credentials or infrastructure changed in this audit.

## 1. Existing email/Supabase path — protected

`App.tsx` mounts `PushNotificationManager`, which calls `useNativePush(user.id)`. Backend selection is `resolveAuthBackend()` in `live/authBackendMode.ts` (stored provider/session, explicit auth choice, then routing).

`lib/nativePush.ts` uses existing Capacitor PushNotifications and FirebaseMessaging plugins. Email registration calls `cleanup_fcm_token_for_user` and upserts `fcm_tokens`; refresh follows the same path. Email sign-out unregisters before Supabase sign-out (`hooks/useAuth.tsx:1231–1243`).

Message database triggers invoke `supabase/functions/process-message-notifications`; event triggers invoke `process-event-notifications`, which calls `enqueue_event_push_v2`. Delivery uses `push_delivery_queue` / `process-push-delivery-queue`, `_shared/pushDispatch`, `send-push-notification`, then `send-fcm-notification`. Native FCM delivery reads `fcm_tokens`; Android targets the existing `default` channel. Existing preferences, retries, deep links and web behavior remain protected.

## 2. Existing ICP path — reuse, not rebuild

- `nativePush.ts:201–213` and `useNativePush.ts:201–209` already route initial/refresh tokens to ICP, not Supabase.
- `live/features/notifications.ts:775–802` wraps caller-authorized register/unregister methods and optional version registration.
- `notification_queue/src/main.mo:1582–1662` derives ownership from caller; tokens are keyed by `(principal, token)`. Worker token reads are consensus updates, not queries.
- `messaging_domain/src/main.mo:1429–1432` enqueues confirmed chat notifications with trusted recipients/mutes; events/reminders and broadcast enqueue paths also exist. Coverage of every requested automatic trigger is not yet established.
- Queue claim/authorize/acknowledge/fail methods enforce worker authorization, account admission, source scope and caller-owned leases. Delivery rechecks club/chat access and category preferences.
- `[TEST] Push delivery worker` runs every five minutes. `scripts/icp-push-deliver.mjs` reads shared caller-owned devices, then authorizes/settles each source queue separately and sends FCM HTTP v1 off-chain.
- Authoritative base DEV mapping: `deploy/mainnet/.icp/data/mappings/ic.ids.json` contains `jfcdq-yiaaa-aaaal-qxloa-cai`. The worker's shorter hardcoded fallback does not match that mapping. Resolve complete DEV inventory before execution.

## 3. Mandatory shared dependencies — stop here

1. **Native taps are not bootstrapped in current runtime source.** `initNotificationLaunchHandler()` is defined at `lib/notificationLaunchHandler.ts:310`, but only tests call it. `nativePush.ts` intentionally does not register another action listener. Enabling the common initializer would also change Supabase taps, so it is not permitted by this request without a narrower integration decision.
2. **ICP logout does not unregister its token before deleting identity.** `useAuth.tsx:1632–1653` clears II without native token removal. Shared `unregisterNativePush()` also deletes the installation's Firebase token, which could affect the other mode. ICP needs captured-identity/target/token cleanup, not that shared helper.
3. **Listeners are not a shared subscription bus.** Calling `setupNativePushListeners()` from another provider adds listeners and risks duplicate foreground handling. Refresh callbacks currently resolve mutable global mode after awaits instead of retaining an account-bound registration lifecycle.
4. **DEV native acceptance conflicts with existing release policy.** Codemagic is PROD-only; do not create DEV Codemagic workflows or change store identity. Need an existing DEV native test build/device or explicit permission for another isolated local testing route.

## 4. Proposed isolated architecture

Internet Identity → confirmed ICP messaging/events operations → owning ICP queue → one authenticated off-chain DEV gateway → existing Firebase project's FCM HTTP v1 → existing Android/iOS plugins.

- Add an ICP-only lifecycle provider with explicit principal, target, installation, token generation and permission state. Register multiple devices in ICP storage; rotate only the relevant installation; revoke before II clears. Never read/write Supabase token rows.
- Preserve shared/email implementations byte-for-byte except any separately approved **ICP-only guarded call sites**. Do not introduce duplicate native action listeners, shared Firebase token deletion or global listener removal.
- Queue must authorize current membership/chat access/mute/preferences/device status immediately before delivery. Default to generic content; preview-disabled messages must never include private text.
- Use a dedicated DEV gateway, fixed verified DEV queue inventory, secrets outside canisters/frontend, authenticated ICP worker calls, bounded deadlines and retries. User requests never supply recipient lists, tokens, queue IDs or message content to the gateway.
- Replace only the ICP messaging wake-up path after the new endpoint exists; never use Supabase storage/delivery as fallback. Normal writes return without waiting for push.
- Operate exactly one delivery runner until attempt-specific leases/expiry/fenced recovery are implemented. The current GitHub concurrency lock does not serialize an independent gateway.
- Use persistent per-device delivery outcomes and stable notification IDs. FCM acceptance and ICP acknowledgement cannot be atomic: do not claim exactly-once delivery; lost acknowledgements require explicit duplicate-handling acceptance.

## 5. Delivery gaps to repair before activation

- Existing instant kick (`verify-iap-receipt-icp?job=push-kick`) is hosted inside a Supabase function and uses stale handwritten Candid: wrong key/result fields, query token listing and missing delivery authorization. Do not enable, edit or deploy it for this request.
- `scripts/icp-push-batch.mjs` marks the whole row delivered if any device succeeds, losing transient failures on other devices.
- Current retries are not attempt-bounded; broad INVALID_ARGUMENT pruning can remove a valid token after a malformed payload. Request deadlines and reliable settlement failure reporting are missing.
- No worker revoke method was found; current recovery resets Processing rows without expiry/attempt fencing.
- Current delivery access check does not establish fresh mute state; `show_message_preview` does not redact the worker's outgoing body. Category mapping needs a complete kind matrix.
- A token can remain linked to several principals; caller scoping alone does not prove exclusive installation ownership. Account-switch safety must be demonstrated server-side and in lifecycle tests.

## 6. File boundaries

**Safe candidates after isolation is agreed:** new ICP-only lifecycle/provider/tests; `frontend/src/live/features/notifications.ts`; ICP-only notification producer code in `frontend/src/live/features/{messaging,events}.ts`; `backend/notification_queue/**` with a new later migration and regenerated Candid/both binding trees; `backend/messaging_domain/**` or `events_domain/**` only for proven missing ICP trigger/authorization work; new DEV-only gateway modules/tests/workflow.

**Shared with PROD ICP delivery, not automatically safe:** `scripts/icp-push-{contract,batch,deliver}.mjs` are imported by PROD delivery. Prefer dedicated DEV modules or a separately reviewed backward-compatible change; never assume an ICP filename means DEV-exclusive.

**Requires decision before changes:** `PushNotificationManager.tsx`, `useNativePush.ts`, `nativePush.ts`, `useAuth.tsx`, `notificationLaunchHandler.ts`, entry bootstrap. Only narrowly ICP-guarded integration may be considered; email branches and common behavior remain frozen.

**Frozen:** all `supabase/**` and database migrations/settings; existing email push helpers/UI behaviors; Firebase initialization; Capacitor plugins/configuration; AppDelegate/Android manifests/entitlements; Firebase config files; `codemagic.yaml`; PROD workflows/scripts/IDs/credentials; `deploy/prod/**`, `deploy/frontend-prod/**`.

**Files changed by this audit:** this assessment and root `roadmap.md`; persistent owner-isolation requirement saved separately. **Changed canisters: none.** Earlier RSVP work is separate, not a push change.

## 7. Firebase/APNs and gateway setup

- Existing compatible Firebase project can be reused without modifying its client initialization. Confirm Android package and iOS bundle already belong to it.
- Android needs the existing Google services configuration, FCM-capable installed build, permission and existing default channel; do not rewrite configuration.
- iOS needs existing Firebase configuration, APNs credential in Firebase, matching signing entitlements/environment and APNs-to-FCM forwarding. Store **FCM**, never APNs, tokens.
- Shared project risk: changing APNs keys, service-account access, client files or Firebase delegate behavior can affect email users; none is authorized here. Obtain a separate server-side credential/connection with the necessary FCM send permission rather than rotating current credentials.
- No accessible Firebase Messaging connector was found. Sandbox worker credentials were not present; this does not establish current GitHub/hosted secret state. The dated setup note reports missing DEV FCM worker configuration, not fresh readiness evidence.
- External gateway hosting, secret provisioning, queue grants and delivery commissioning remain outstanding. Never paste private keys in chat or store them in canisters.

## 8. Tests and acceptance

Executed existing tests before runtime changes: **45 tests passed in 5 files**:
`icpPushWorkerContract`, `icpPushWorkerResults`, `icpPushBatch`, `PushNotificationManager`, `notificationLaunchHandler`.

These cover contracts, lease denial, source-queue separation, between-device access revocation, orchestration and simulated taps. Manager tests mock native registration; launch tests explicitly invoke initialization and therefore miss its absent runtime call site. Mocked club-switch lookups emitted warnings. Passing these tests is not a device-delivery result or comprehensive unchanged-behavior proof.

Required additions: installation/account switching; refreshed tokens during logout; ICP/Supabase negative-call assertions; no duplicate listeners; current mute/preview/category rules; partial-device retries; stale attempts/worker revocation; uncertain FCM acknowledgements; invalid payload versus invalid token; DEV inventory/project mismatches; automatic event/reminder generation.

**Android/iOS physical tests: not run.** No authenticated native device or DEV-native build was available. Both ICP and existing email foreground/background/closed delivery, taps, multiple devices, logout/rotation/preferences and no duplicates must pass. OS force-stop/force-quit restrictions must be recorded rather than bypassed.

## 9. Costs — planning model, not measured quote

Current five-minute GitHub schedule: 288 executions/day, roughly 8,640/month. At 1–2 billed runner minutes each, approximately 8,640–17,280 runner minutes/month before included allowances; actual price depends on GitHub plan and measured duration. A dedicated gateway avoids using Actions as an always-on near-real-time service; hosting price depends on the selected service.

For N recipient notifications and D mean devices, expect roughly N×D FCM requests plus retries, N×(1+D) delivery-authorization updates and N settlement updates, plus claims, device reads and inter-canister access checks. Per-device acknowledgement/fencing adds operations. FCM sending generally has no per-message fee; verify provider terms when commissioning. ICP cost = measured cycle delta per representative delivery × monthly deliveries plus idle/storage costs, converted at current cycles/XDR pricing. No measured cycle-per-push or monetary gateway quote is available; do not invent one.

## Acceptance status

**Not complete.** Shared lifecycle/tap integration needs a decision before implementation under the owner's stop rule; credential/hosting commissioning and real Android/iOS dual-mode acceptance remain required. PROD and existing Supabase push are untouched.