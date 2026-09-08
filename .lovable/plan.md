# Desktop: stop hiding features behind the FAB

Desktop (lg and up) has room the phone doesn't. Today the left rail only carries Home, Messages, Schedule, Media, and everything else (News, Vault, Pitch Board, joining a team, Clubs) is buried in the plus-menu or the account dropdown. Mobile stays exactly as it is.

## 1. Expand the left nav rail

The rail becomes the real navigation surface, grouped with a thin divider:

```text
[logo]
Home
Messages
Schedule
Media
──────
News          (only when the user's clubs have news, or they can publish)
Vault         (only when canAccessVault; Pro-locked shows a small lock)
Clubs & Teams
──────
Pitch Board   (only when the user coaches/admins a team)
```

- Icons keep the current rail treatment; each gains a small label under the icon at `lg` (rail widens 80px → 96px) so items are self-explanatory without hover.
- Items the user has no permission for are simply not rendered — no dead ends.
- Pitch Board has no standalone route (it lives at `/events/:id/groups/:groupId/pitch`), so the rail item routes to the user's next upcoming game and opens its pitch board; if there is no upcoming game, it goes to `/events` with a short toast. This keeps the routing logic in one small helper.

## 2. Desktop action bar on Home

Above the Home content column at `lg`, a single row of real buttons replaces the need to open the FAB:

```text
[+ New Event]  [+ News Post]  [Upload Photo/Video]  [Invite Members]  [Join Team]
```

- Each button is permission-gated with the same conditions the FAB uses today (canCreateEvent, publishable clubs, hasTeams, etc.).
- The FAB itself is hidden at `lg` on Home since every one of its primary actions is now visible; "More actions" items that don't fit (Create Team, Competition, Association, Admin Tools) move into a single `More ▾` dropdown at the end of the row.
- No behaviour changes: the buttons call the exact same handlers the sheet rows call.

## 3. Header stays as-is

The recent header work (theme toggle, Clubs & Teams, Settings, Sign Out, avatar → profile) already covers account actions, so nothing moves there.

## Technical notes

- `src/components/layout/DesktopNavRail.tsx` — add grouped items, labels, permission gating, and the next-game pitch-board resolver.
- New `src/components/home/DesktopActionBar.tsx` — the button row; reuses the handlers already passed into `HomeQuickActionsFab`.
- `src/pages/HomePage.tsx` — render the action bar at `lg`, hide the FAB at `lg`.
- New small hook for "next game with a pitch-board group" reused by the rail.
- All gating reuses existing hooks (`useClubTheme`, vault access, `useNewsPublishableClubs`, Pro checks); no new queries against new tables, no mobile-visible changes, no new colours.
