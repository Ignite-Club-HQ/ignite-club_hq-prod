# ICP fallback audit — DEV

## Repairs

- Strict transport and feature dispatch recognize the mounted ICP provider
  before a restored delegation is available. Missing canister IDs fail closed
  rather than selecting a Supabase provider.
- Feature routing recognizes an explicit ICP sign-in choice during startup.
- Email refresh, token, mutation-session and eager chat-session helpers do not
  call Supabase in strict ICP mode. In-flight refresh recovery cannot return an
  old email session after the sign-in method changes.
- Legacy media-cache background refresh does not query Supabase for ICP users
  or apply late email results after a switch.
- Media feed polling replaces the legacy Supabase subscription when ICP is
  selected. Feed/engagement effects include the backend mode so changing mode
  with the same account/photo IDs retires email channels.
- Realtime refusals remain visible while an ICP provider restores its session;
  genuinely signed-out teardown retains the existing inert-channel behavior.

The realtime inventory was checked for page/component/hook guards, including
chat, media, notifications, pitch, shared settings and admin diagnostics. Many
legacy readers are intentionally Supabase-only and selected by their calling
screens; this is not a claim that every file containing Supabase was removed.
Strict network refusal remains the final application-data boundary.

## Verification

Expanded application tests include all `src/live`, media repositories/hooks,
native recovery, presence/activity isolation, strict client, media cache and
email-session helpers. Both modes completed successfully:

| Mode | Passed | Failed | Skipped | Files passed / skipped |
| --- | ---: | ---: | ---: | --- |
| Supabase | 1,699 | 0 | 35 | 222 / 7 |
| ICP | 1,691 | 0 | 43 | 222 / 7 |

Tests include every one of the 14 feature areas refusing missing-canister
fallback, mounted-session restoration, preserved email routing, scoped dispatch,
denied/unknown ICP outcomes, media-mode cleanup and refresh isolation.
Preview build reports build OK. Public `/auth` renders with no page errors;
that signed-out check is not authenticated acceptance.

Complete all-application baselines were attempted concurrently but interrupted
after approximately 500 files per mode without final summaries. Their partial
logs are retained separately, not counted as passing complete baselines.

## Preserved boundaries and limits

No production deployment, data, permissions or configuration changed. Email
mode remains authoritative for email sessions. Approved stored-media byte,
purchase-verification, feedback/welcome and isolated native push transports were
not removed or expanded; they do not permit Supabase application-data fallback.

Authenticated installed-phone flows cannot be verified here: the Internet
Identity delegation/device is unavailable, and Supabase auth is externally
managed. This audit proves the covered isolation cases, not that every possible
phone path is free of blocked fallback attempts. No diagnostic suppression or
network guard weakening was introduced.

The root architecture file is over its user-owned rule budget; the scoped
restoration/session/media isolation rule is in frontend/src/AGENTS.md.