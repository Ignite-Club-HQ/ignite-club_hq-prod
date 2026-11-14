# Event-invitation queue write authorization — source audit and release gates

## Scope and environment

This is a narrow **source-only** fix for the forged `event_invite` label discovered while reviewing draft PR #1513. Group 2's "DEV" test accounts are on **ICP mainnet canisters**: do not conflate the app's DEV frontend with an isolated test network. This branch **does not** merge, upgrade, deploy, enqueue live events, change PROD configuration, or expose `notification_queue` through the MCP discovery manifest.

## Audited entry points and legitimate callers

| Path | Current legitimate use | Effect of this change |
| --- | --- | --- |
| `events_domain.sendEventNotice` → `club_domain.relay_event_notice` → queue `fan_out` | Official `event_invite`, event reminders/cancellations, duty notifications; club relay verifies the trusted events canister before forwarding | **Allowed** for `event_invite`, because the actual queue caller is the configured Club canister |
| Queue `fan_out` from web/mobile `fanOutLiveNotifications` | Browser-issued membership, team roles, schedule refresh, rewards, event reminders/notes, etc. | Other kinds **unchanged**; browser-issued `event_invite` is **denied**. The event UI's ICP resend action already uses `notifyLiveEventAudience` on `events_domain`, not generic queue fan-out |
| Queue `enqueue` from web/mobile `enqueueLiveNotification` | Individual gamification/reward and club notifications with caller-provided ID/body | Other kinds **unchanged**; directly enqueued `event_invite` is **denied**, including attempts with a forged canonical ID/key |
| `messaging_domain` queue fan-out | Chat/media photo reminder, messaging events | **Unaffected** for current kinds; cannot impersonate the Club service for `event_invite` |
| Queue worker claim/settle and existing inbox read actions | Dispatch and per-user inbox access | **Unchanged** |
| Legacy Supabase notifications/FCM | Separate production-capable backend | **Not modified**; this fix applies only to the ICP queue canister |

Source references: `backend/events_domain/src/main.mo`, `backend/club_domain/src/main.mo`, `backend/notification_queue/src/main.mo`, `frontend/src/live/features/notifications.ts`, `frontend/src/hooks/useEventReminderMutations.ts`, `frontend/src/lib/gamificationNotify.ts`, and `backend/messaging_domain/src/main.mo`.

The generic frontend routing accepts dynamic notification kinds. Existing searched callers do not appear to depend on direct `event_invite` fan-out in ICP mode. An unknown external caller relying on that unauthorised behaviour **will now be rejected**. Review installed clients/plugins before promoting this to mainnet.

## Implemented minimal policy

`eventInviteWriteAllowed(kind, id, key, caller)` requires `caller == configured clubDomainCanister` if **either** the kind is exactly `event_invite` **or** the notification ID/key begins with the reserved `event_invite-` namespace. It blocks forged IDs/keys under another notification kind, not merely forged labels. Normal non-invitation notifications using other ID/key prefixes retain their existing permissions. A club administrator, coach, parent, governor or messaging service does **not** inherit the Club canister's caller identity.

Both `enqueue` and `fan_out` check this **before admission** and **again just before mutation**, after potentially suspending `await` calls. Without a configured Club canister, `event_invite` fails closed. The kind filter is exact-match, with the reserved canonical ID/key namespace protected across kinds: other event kinds using unrelated keys retain existing behaviour. No data migration or Candid shape change.

## Tests: local only

- `node --test scripts/event-invite-queue-authority.test.mjs`: verify both paths and both pre-/post-await guards; verify only the exact invite label is restricted; verify trusted service routing.
- `frontend/scripts/test-event-invite-queue-authority-replica.mjs`: compile real `club_domain`, `events_domain` and `notification_queue` Motoko Wasm into disposable PocketIC. Confirm direct `fan_out` and `enqueue` rejects untrusted users, club admins/governor and messaging service; a browser cannot pre-seed the canonical event-invitation ID/key even using a different notification kind; the legitimate `events_domain → club_domain → notification_queue` call succeeds exactly once; legacy non-invite fan-outs and enqueues still work. No device token or external push.
- Run the existing `frontend/scripts/test-event-setup-replica.mjs` regression on the same local-only compile (tests reminder workflow).
- PR-only Actions workflow checks Motoko source compilation and runs the above tests without a deployment.

## Coordination with #1513

PR #1513 introduces a **read-only**, Test2-specific delivery status lookup using the canonical event-invite key. The current branch addresses the integrity of **new** queue submissions; PR #1513 must not be enabled on mainnet before a trusted-source policy is installed and independently reviewed. Preferred deployment order after explicit separate approvals: this authorization fix → verify the official event path → consider #1513. Neither draft PR authorises the other to merge/deploy.

**Historic notifications are not authenticated retroactively.** A pre-upgrade matching row could have been inserted under the old permissive policy. A canonical key alone does not prove the provenance of such a row. PR #1513 therefore still needs provenance caveats for past rows and a trustworthy post-upgrade event test.

## Remaining security gaps

1. Broader event kinds such as `event_reminder`, `event_cancelled`, `event_note` and `event_updated` are **outside this narrow change**; review their separate authorization requirements before promising they are trusted.
2. `event_invite` writes from a compromised trusted Club canister are out of scope: this is a **canister identity** check, not cryptographic message signing.
3. The Queue canister is a shared mainnet Group 2 service. Require independent security/code review, a backward-compatible rollout plan, and explicit owner approval for **any** upgrade. No live writes or deployment in this PR.
