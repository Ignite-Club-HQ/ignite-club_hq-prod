# ICP startup/presence warnings — DEV repair

The owner screenshots show blocked email authentication, `heartbeat_presence`,
and live-update calls. The direct-message subscription is addressed separately
in direct-message-updates-2026-11-21.md.

## Confirmed source paths and repairs

- Native network recovery always called Supabase `/auth/v1/health`, including
  during Internet Identity startup/resume. It now resolves the active target
  on each attempt and calls ICP `/api/v2/status` in strict ICP mode. Supabase
  sessions keep the original endpoint. Reachability grants no app permissions.
- Presence callbacks only checked channel/account ownership. An email callback
  waiting on `track` could continue into `heartbeat_presence` after switching
  to ICP. Strict mode now gates ownership and reconnects; teardown retires
  ownership synchronously before awaiting cleanup. Presence mode is included
  in effect dependencies, so same-account mode changes retire the old channel.
- Activity tracking gated the initial render, but duration/unload callbacks
  and awaited session reads could retain email state across a switch. They now
  recheck strict mode and clear email-only token/log references in ICP mode.

The transport refusal remains enabled. No diagnostic messages are suppressed
or erased. These source paths explain the warnings, but the screenshots do
not establish that every email-authentication occurrence came from these paths.

## Verification

Eight focused files ran in both modes at 09:50 UTC, 21 November 2026:

- Supabase: 54 passed, zero failed, zero skipped.
- ICP: 54 passed, zero failed, zero skipped.
- Tests cover ICP/email status URLs, changed engine destination, in-flight
  presence callbacks, same-account reconnect cancellation, five page paths,
  email activity retention, and obsolete duration/unload suppression.
- Existing resume/reconnect recovery, shared settings, strict transport and
  direct-message update checks also pass. Preview reports build OK.

The initial new probe test needed asynchronous dynamic-import setup to settle;
after correcting its timing, both full focused runs passed.

This is DEV source work, not a native deployment or signed-in phone acceptance.
No backend, production settings, data, controllers or permissions changed.
Paul's installed-app warnings require a later approved updated build and his
Internet Identity session/device to verify. Scoped architecture rule is recorded
in frontend/src/AGENTS.md because the root user-owned rules exceed its budget.