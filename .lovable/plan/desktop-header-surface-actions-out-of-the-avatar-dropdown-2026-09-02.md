# Desktop header: surface actions out of the avatar dropdown

Desktop (lg and up) has plenty of horizontal room, so the account dropdown shouldn't hide everyday actions. Mobile stays exactly as it is today.

## Proposed desktop header (right side)

```text
[ Dark/Light toggle ]  [ Clubs & Teams ]  [ Bell ]  [ Avatar ▾ ]
```

- **Dark/Light toggle** — icon-only ghost button (sun/moon), instant, with tooltip. Most-used, least "account-like" item.
- **My Clubs and Teams** — icon+label button (Building2 + "Clubs & Teams"), navigates to the active club detail page or /clubs. Frequent navigation, deserves one click.
- **Bell** — unchanged.
- **Avatar dropdown** — slims down to identity + rarely used items:
  - Header row: avatar + name (+ active club name as subtext)
  - My Profile
  - Settings
  - Demo Accounts (app admin only)
  - Sign Out

Result: 4 items in the dropdown instead of 6, and the two most-tapped actions become one click.

## Behaviour rules

- Extracted buttons render only at `lg:` and above and only on non-native platforms; below `lg` the dropdown keeps all current items so mobile is unchanged.
- Duplicates are avoided: when a dropdown item is promoted to the header, it is hidden from the dropdown at that breakpoint (`hidden lg:flex` on the button, `lg:hidden` on the menu item).
- Theme toggle keeps the existing `handleThemeToggle` + `isSavingTheme` disabled state and aria-label announcing the target mode.
- Clubs button reuses the existing navigate logic (active club detail page when a club theme is active, otherwise `/clubs`).

## Technical notes

- Single file: `src/components/layout/AppHeader.tsx`.
- New buttons inserted before the notifications `DropdownMenu` in the right-hand action row, using existing `Button variant="ghost"` and semantic tokens — no new colors.
- Tooltip via existing shadcn `Tooltip` for the icon-only theme toggle; the clubs button carries a visible label so no tooltip needed.
