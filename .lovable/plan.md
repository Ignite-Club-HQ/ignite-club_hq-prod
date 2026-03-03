

## Plan: Subs Manager as a Match Duty (Not a Permanent Role)

### Concept

Instead of adding a permanent `subs_manager` role, we add "Subs Manager" as a new duty type in the `AddDutySheet`. When a coach/admin assigns this duty to a parent for a specific match, that parent gets:

1. **Edit access** to the pitch board for that match only
2. **Push/in-app notifications** for subs, half-time, full-time for that match only

No database schema changes needed -- the existing `event_group_duties` and `duties` tables already support named duties with `assigned_to` user IDs.

### Changes

**1. Add "Subs Manager" duty option to `AddDutySheet.tsx`**

- Add a new entry to `ALL_DUTY_OPTIONS`: `{ id: "Subs Manager", label: "Subs Manager", icon: UserCog, description: "Pitch board access" }`
- Include it in `MINI_LEAGUE_MATCH_DUTIES` (alongside Referee, Linesperson)
- For regular (non-mini-league) game events, it will also appear in the full duty list

**2. Grant pitch board edit access based on duty assignment**

- **`EventGroupPitchPage.tsx`** (~line 121-143): In the `userCanEdit` query, also check `event_group_duties` for a "Subs Manager" duty assigned to the current user for the current group. If found, grant edit access.

- **`TeamDetailPage.tsx`** (~line 353): For regular team events, when a pitch board is opened with a `linkedEventId`, check if the user has a "Subs Manager" duty assigned on that event's `duties` table. If so, set `readOnly = false`.

- **`HomePage.tsx`** (~line 1062-1070): For the home page pitch board widget, when opening a team's pitch board that has a `linkedEventId`, check if the user has a "Subs Manager" duty on the linked event. If so, include it in the editable list rather than read-only.

**3. Include Subs Manager assignees in push notifications**

- **`check-pending-subs/index.ts`** (~line 48-63): In `getTeamStaffUserIds`, also query `event_group_duties` (for mini-league matches) and `duties` (for regular events) where `name = 'Subs Manager'` and `assigned_to IS NOT NULL`, using the `linkedEventId` from the active game's pitch state. Add those user IDs to the notification recipient list.

- **`PitchBoard.tsx`** (~line 2078-2082): In `notifyFormationOrSizeChange`, also query duties for "Subs Manager" assignees and include them in push notification recipients.

**4. MiniLeagueGameWidgets.tsx**

- In the `isAdmin` check that determines `readOnly` for the pitch board, also check if the current user is the "Subs Manager" assignee for that specific event group.

### Files to Change

| File | Change |
|------|--------|
| `AddDutySheet.tsx` | Add "Subs Manager" duty option with `UserCog` icon |
| `EventGroupPitchPage.tsx` | Check `event_group_duties` for Subs Manager assignment to grant edit access |
| `TeamDetailPage.tsx` | Check `duties` table for Subs Manager on linked event |
| `HomePage.tsx` | Include Subs Manager check when determining `readOnly` |
| `MiniLeagueGameWidgets.tsx` | Include Subs Manager check for `isAdmin` |
| `PitchBoard.tsx` | Include Subs Manager assignees in formation change notifications |
| `check-pending-subs/index.ts` | Query duties tables for Subs Manager assignees alongside team staff |

### How It Works End-to-End

1. Coach creates a match event and adds a "Subs Manager" duty
2. Coach assigns the duty to a parent
3. Parent opens the pitch board for that match -- system detects the duty and grants full edit access (not read-only)
4. Parent receives push notifications for subs, half-time, full-time for that match
5. Duty is scoped to that event only -- no permanent role elevation

