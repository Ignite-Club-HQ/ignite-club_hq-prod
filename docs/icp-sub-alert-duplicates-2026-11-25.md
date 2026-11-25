# Duplicate substitution alerts — 25 November 2026

## Rule
One substitution due time should produce one phone alert per recipient/device, even when several players change together. Different due times and halves remain separate. Existing sent notifications are not rewritten.

## Reproduction and repair
- Two changes at H1 300 seconds produced two different notification keys because outgoing/incoming player IDs were part of each key. A regression reproduced two queued IDs where one was expected.
- Keys now identify the plan run, half and due time, not each player change. The schedule deduplicates repeated keys before sending its replacement list.
- The closed-board monitor independently enqueued substitutions with a different prefix. ICP pending-sub checks now defer to the registered server schedule; local confirmation dialogs and email-mode checks stay intact.
- Shared match open-board alerts pass through events_domain, which prefixes keys with `pitch-<group>-`. Server schedules now use that exact prefix too, so both reach the same queue row.

## Places checked by reading code
| Place | Finding |
| --- | --- |
| Home/team/event entry points to PitchBoard; portrait and landscape layouts | Shared board owns alert effects; layouts do not implement separate push producers. Shared repair applies whichever entry opens the board. |
| PitchBoard schedule and pending-sub effects; pitchBoardRepository | Per-player keys broke the rule; repaired due-window IDs and duplicate schedule entries. |
| GlobalSubMonitor pending-sub flow | Independent ICP producer broke the rule; disabled only that producer. Confirmation and other alert types remain. |
| useAutoSubs, useAutoSubScheduler, usePitchBoardTimer, triggerPitchCheck | Due detection uses a primary plus batch; timer drives that same detection. The edge-function check explicitly skips ICP. No additional ICP push producer here. |
| useAutoSubNotify (legacy basketball/netball notifier) | Explicit ICP guard, no production caller found; email behavior unchanged. |
| GameTimer beeps and browser notification utility | Existing separate browser alert wording; not the two identical native `Sub due` alerts in the screenshot. No shared native/browser behavior changed. |
| livePitchRecipients and notificationRecipients | Staff/duty audience selection and principal normalization/deduplication retained. |
| events_domain.notify_group_pitch and club_domain.relay_group_pitch_alert | Existing manager checks and duty audience retained; discovered relay key namespace and matched server schedules to it. |
| notification_queue.schedule_pitch_sub_alerts and deliverDuePitchSubAlerts | Timer IDs are `key-user`; same-ID rows already skip insertion. New client keys now exploit that existing deduplication. |
| notification_queue.fan_out | Same `key-user` IDs and existing-row no-op; no settled-row edits required. |
| notification_queue.reserve_native_push/register_device_token | Atomic source reservation, token ownership and occupied attempt checks retained. |
| ICP sender authority, delivery, FCM envelope and drain loop | One send per reservation; uncertain delivery/settlement is held, not automatically replayed. Android tag uses notification ID. No sender changes needed. |
| icpPushLifecycle and icpPushTap | Registration is serialized/account-bound; tap handler navigates, not a second delivery. |
| usePitchBoardNotifications and email branches | Preferences and Supabase dispatch remain unchanged. The referenced hosted check-pending-subs job is not present in this checkout; its implementation was not claimed checked or modified. |

## Verification and release boundary
- Focused regression suite: eight files, 65 passes / one existing skip in email mode; 52 passes / 14 intentional email-only skips in ICP mode.
- Includes concrete two-change/one-alert reproduction, separate-half/time checks, closed-board ownership and actual repository schedule/fan-out ID assertions for normal and shared matches.
- Preview build reports OK. No production deployment, credentials, permission/settings changes or historical notification writes.
- Physical Android/iOS delivery cannot be verified here. A new phone build and a fresh locked-phone substitution-window test are still required before claiming live delivery fixed.