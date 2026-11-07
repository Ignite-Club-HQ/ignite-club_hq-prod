# DEV ICP sender on Supabase

Paul selected Supabase hosting on 7 November 2026. This project uses an external,
user-connected Supabase project, not Lovable Cloud. The sender can run there;
the Firebase connector's credential gateway remains Lovable-hosted.

## Completed setup

- Linked Paul's existing Firebase Messaging connection to this DEV project.
- Confirmed the generated application's credential path: verification returned
  HTTP 200, outcome `verified`. No notification was sent.
- New sender must use `FIREBASE_MESSAGING_API_KEY` and `LOVABLE_API_KEY` on the
  server, through the Firebase Messaging connector. Existing `FCM_*` secrets
  and all email notification handlers remain untouched.

## Isolated implementation boundary

Internet Identity → existing ICP queue/recipient authorization/device directory
→ new DEV-only Supabase sender → Firebase → native devices.

Supabase is only hosting the new sender. Do not move ICP registrations, queue
records or recipient selection into existing Supabase notification tables. Do
not invoke existing email delivery handlers or the stale ICP push-kick handler.
Use generic lock-screen text and the existing `icp-dev` recipient-bound envelope.

## Activation blockers

1. The existing granted TEST worker signing credential is not available in
   this project's secret store. Do not replace it with a newly minted identity
   or request that Paul publish it in chat. Secure worker provisioning and
   exact grant readback are needed.
2. The current queue lacks the durable per-installation attempt journal,
   exclusive installation ownership, fresh mute/device authorization and
   attempt-fenced recovery required by the DEV delivery core. Implement these
   before real sends; do not substitute an in-memory Edge Function journal.
3. The GitHub worker's `recover()` resets all processing rows. It must not
   overlap the new sender. No GitHub job or schedule was disabled or changed.
4. A queue wake-up/retry mechanism is still needed. An Edge Function is not
   an always-running daemon. Do not promise seconds-level delivery from a
   minute-based polling job or create a permanent queue sweeper. Prefer
   authenticated bounded wake-on-enqueue with retries only while work remains.
5. Real TEST Android/iOS delivery and unchanged email-mode acceptance remain
   required. Registration stays commissioning-disabled.

## Status

Firebase hosting access is ready; the sender is **not deployed or active**.
The next step prepared `supabase/functions/icp-dev-push-sender/fcm.ts`, a
server-only transport with no public endpoint or scheduler. It pins the DEV
Supabase host, rejects non-ICP and cross-account envelopes, emits generic text,
uses one bounded gateway request, preserves definite provider errors privately,
and treats missing/ambiguous acceptance as held rather than replayable.

Six transport tests plus six existing per-device delivery tests pass (12 total).
They use synthetic credentials and mock HTTP responses; no notification was
sent and no real phone delivery was tested. The transport is not called by the
app or existing workers. An `index.ts` is intentionally absent, so the current
function selection/deployment inventory does not publish this draft.

Existing worker handover remains blocked: GitHub does not expose stored secret
plaintext through its API, and this project's secret list contains no TEST
worker signing key. Do not ask Paul to recover an unreadable secret or print it
in Actions logs. Secure server-to-server handover through an authorized existing
job or an explicitly reviewed new-worker commissioning flow is needed.

No canister, database, scheduler, email-push function, native configuration or
production change occurred. Queue journal/ownership/mute/fencing and physical
Android/iOS dual-mode acceptance remain unfinished.