# ICP gallery and chat image allowance parity

## Compared behavior

- Email gallery submit checks `get_club_free_usage` and refuses an album whose photo count would exceed the existing 10-per-cycle Free allowance. Image files are limited to 10 MiB after preparation.
- ICP gallery previously skipped that album preflight and relied on independent per-file store refusals, so an album could partially upload before reaching the cap.
- ICP usage reads silently skipped inaccessible stores, returning empty/partial counters as zero. The usage hook also used sponsor-oriented `isLiveClubPro`, which can fall back to a viewer's personal entitlement, and zeroed all Pro counters.
- Team-only ICP chat inputs could use `general/chat/...` before discovering their club; that path has no club photo category. Chat upload completion did not refresh its ICP usage meter.
- Existing store `begin_upload` already checks the scoped server-derived allowance, committed counts and pending reservations after asynchronous reads. Free gallery and chat photo categories each have 10 uploads per 30-day epoch cycle; the plaintext 10 MiB limit is distinct from encryption framing. Existing governor exceptions, on-chain counters, routing, encryption and storage data were not changed.

## Corrections

- Shared photo preflight reads the owning group's `get_media_allowance` (including exact team when present), not personal subscription hints, and complete store counters.
- Gallery rejects an over-limit entire album before publishing or closing; every central ICP photo upload rechecks immediately before encryption. Server reservations remain the race-safe authority.
- Unreadable, missing or incomplete configured-store counters stop the check instead of granting unused quota. No email application fallback is used.
- ICP usage displays actual counts, applies caps only to Free clubs, and uses the same server-derived club entitlement.
- Team-only chat uploads resolve their owning club or stop; gallery and chat success refresh usage. Branding, personal/non-club photos and document category behavior remain unchanged.
- Gallery errors retain known plain-English allowance refusals rather than hiding them behind a generic upload error.

## Validation and limits

- Focused tests cover tenth/eleventh gallery and chat photos, whole-album boundaries, independent category counts, server Pro/trial exemptions, exact group/team scope, incomplete/unavailable counters, multi-store totals, pre-encryption refusal, team-only chat admission, usage refresh and gallery continuation after navigation.
- Ten focused files pass in email mode and ICP mode: 65 checks each, 130 total.
- Preview compilation is successful. Existing denial/transport recovery tests are retained.
- A real signed-in upload and installed-phone acceptance could not be checked: session minting refuses this user-managed authentication setup. No live canister operations, production deployment, data changes or email-mode changes were performed.
- Root architecture rules were not expanded because their existing user-owned content exhausts its size budget; the scoped live rule documents the shared quota policy.