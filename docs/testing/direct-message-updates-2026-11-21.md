# Direct-message live-update crash

The supplied installed-app stack points to DirectMessagePage opening a Supabase
channel while strict ICP mode is active. Its subscription effect had no transport
guard, unlike the neighbouring chat screens. The strict client is unchanged.

Direct messages now choose the transport only after authentication. ICP uses the
existing chat socket pokes with a 15-second foreground fallback poll, and catches
up when the document becomes visible. Reads still use the page's authorized
message/reaction reader. Email mode retains its existing subscription and cleanup.
Transport selection also recognizes Internet Identity when a feature ID is absent,
preserving the existing fail-closed ICP read path rather than opening Supabase.

## Verification

Five focused test files ran in each backend mode on 21 November 2026:

- Supabase: 42 passed, zero failed, two existing mode-specific skips.
- ICP: 39 passed, zero failed, five existing mode-specific skips.
- New mounted-hook regressions cover no ICP fallback, socket/poll refresh,
  visibility recovery, authentication gating, mode-switch cleanup and unmount.
- Existing messaging, typing, chat-read and resume-watchdog regressions pass.
- Preview build reports `build OK` at 09:46:36 UTC.

No backend, Supabase client guard, production configuration, permissions or
deployed native app changed. An authenticated installed-phone direct-message
flow remains unverified: the user's Internet Identity delegation and device are
not available in this sandbox. The native fix requires a later approved release.

The root architecture file's existing user-owned rules exceed its budget; the
focused transport rule is recorded in frontend/src/AGENTS.md instead.