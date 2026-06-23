## Audit findings: invite signup → club filter

Traced the end-to-end flow for a brand new user accepting a Bridgewater SC invite. **It will NOT auto-apply today.** Two independent bugs cancel my recent seeding fix.

### Bug 1 — Sentinel is written before CompleteProfilePage seeds

Order of events on signup:

```text
sign up → SIGNED_IN
  ↓ useAuth.fetchProfile reads profiles.active_club_theme_id = null
  ↓ setAuthThemeHint(userId, null)
useClubTheme loadThemeFromDb runs
  ↓ consumeAuthThemeHint → { value: null }
  ↓ localStorage stored = null, DB = null
  ↓ ELSE branch (useClubTheme.tsx:629-639)
  ↓ writes NO_CLUB_THEME_SENTINEL into ignite-club-theme-<uid>
CompleteProfilePage finishes invites
  ↓ my seed code: `existingPreference !== null` (it’s the sentinel)
  ↓ skip → club is never seeded
```

Net effect: sentinel pins the user to “All Clubs” regardless of invite.

### Bug 2 — Seed happens after useClubTheme already initialised

Even if Bug 1 were fixed, `useClubTheme`’s `loadThemeFromDb` and localStorage-read effects depend on `[user?.id, isDarkMode]`. The user is the same across CompleteProfilePage and the home redirect, so the hook never re-reads my new localStorage value. It would only show up after a full reload.

### Bug 3 — Home invite-accept path also bypassed

Invites accepted via `HomeInviteFlow` / `PendingInviteCard` / `PendingInvitesList` (the on-home “accept” buttons used by users who already completed their profile but get invited to a second club later) never go through CompleteProfilePage, so they also have no seeding hook.

### Bug 4 — DB never learns about it

The seed only writes to localStorage. `profiles.active_club_theme_id` stays null, so on another device the invited user lands with no club filter — and on this device the SIGNED_IN sentinel write would resurface.

---

## Fix plan

Three small, surgical changes — all keep the “never auto-switch after signup” rule intact.

### 1. `src/pages/CompleteProfilePage.tsx`

- Pull `setActiveClubTheme` from `useClubTheme()`.
- Keep the existing `firstInvitedClubId` collection.
- After invites finish, **only when `firstInvitedClubId` is set AND the user came in via the invite flow** (`pendingInvites.length > 0 && acceptInvites`):
  - call `setActiveClubTheme(firstInvitedClubId)` — this writes localStorage, updates state, and syncs `profiles.active_club_theme_id` in one place.
- Remove the manual `localStorage.setItem` block I added — `setActiveClubTheme` already handles it correctly and triggers a re-render.

This is user-driven (they accepted the invite), so it does not violate the “only manual changes” rule.

### 2. `src/hooks/useClubTheme.tsx` — stop the premature sentinel write for new users

In `loadThemeFromDb` (around line 629), tighten the “DB has null → write sentinel” branch:

- Only write `NO_CLUB_THEME_SENTINEL` when **the localStorage key already exists** (i.e. an explicit prior preference). For brand-new users (`storedPreference === null` AND `data.active_club_theme_id === null`), leave localStorage untouched so CompleteProfilePage’s `setActiveClubTheme(invitedClubId)` can win the race without being overwritten.

This keeps cross-device “Ignite Mode” sync working for existing users while removing the false sentinel-on-signup.

### 3. Home-side invite acceptance (Bug 3)

Centralise the seeding so any invite-accept path benefits:

- Add a tiny helper `src/lib/seedClubFilterFromInvite.ts` exporting `seedClubFilterFromInvite(clubId, setActiveClubTheme, opts)`:
  - reads the current localStorage key for the user;
  - if it equals the sentinel **and was written within the current session** (track an in-memory flag on `useClubTheme`), or is null, call `setActiveClubTheme(clubId)`;
  - otherwise leaves the user’s existing choice alone.
- Wire it into:
  - `CompleteProfilePage` invite loop (step 1).
  - `HomeInviteFlow` / `PendingInviteCard` / `PendingInvitesList` accept handlers — pass the club id resolved the same way CompleteProfilePage does (invite.club_id or `teams.club_id`).

For users who already have a chosen club, this never overrides; for first-time invite accepts it applies the inviting club’s theme.

### Verification

- Cold signup via Bridgewater invite link → land on home with Bridgewater theme applied (logo, colours), `localStorage['ignite-club-theme-<uid>']` = Bridgewater id, `profiles.active_club_theme_id` = Bridgewater id.
- Existing user with Club A selected accepts a new invite to Club B → stays on Club A (no override).
- Existing user with explicit “All Clubs” (sentinel) accepts first ever invite → applies the inviting club.
- Logout/login still preserves the user’s last manual choice (covered by the existing audit).

No edge function or schema changes; no migrations.
