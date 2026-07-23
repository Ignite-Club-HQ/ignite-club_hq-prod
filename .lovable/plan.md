
## Goal
Let club admins + committee create a **club-wide match** (a game event with no single team) and, on the event page, group the RSVP lists by **age level** (U8, U9…) or **team** (U8 Blue, U8 Red…) as chosen at creation time.

## User flow
1. In Create Event, when type = **Game**, the Team dropdown gains an "**All Club**" option (same pattern already used for Social).
2. Selecting All Club reveals a new **RSVP grouping** control with three options:
   - No grouping (flat list — current behaviour)
   - Group by age level (U8, U9…)
   - Group by team (U8 Blue, U8 Red…)
3. On the event detail page, when a grouping is set, each attendance bucket (Going / Maybe / Not Going / No Response) is rendered as collapsible sections with the group name and count.
4. Edit Event exposes the same controls so admins can change grouping later.

## Scope guardrails
- Only game and social events can be club-wide. Training stays team-only (unchanged).
- Grouping applies only when `team_id IS NULL`. When a team is selected, the field is hidden and stored as `NULL`.
- No changes to RSVP semantics, notifications, RLS, or reminders — the existing club-wide code paths (already used by Social) are reused. Every member of the club is addressable.

## Technical details

### Database
- Migration adds `events.rsvp_grouping text` (nullable, values: `'level' | 'team'`).
- Add a `CHECK` constraint restricting the value, and a validation trigger ensuring `rsvp_grouping` can only be set when `team_id IS NULL`. No new RLS.

### Frontend
- `src/pages/CreateEventPage.tsx`
  - Change the Team selector guard so `type === "game"` also allows the `__all__` option, mirroring social.
  - Drop the "team required for games" toast when the user picked All Club.
  - Add `rsvpGrouping` state + a `MobileCardSelect` shown only when `!teamId && (type === "game" || type === "social")`.
  - Persist `rsvp_grouping` on insert (games and socials only, else `NULL`).
- `src/pages/EditEventPage.tsx` — mirror the same additions.
- `src/lib/eventScopeValidation.ts` — no change (already allows null team_id).
- `src/pages/EventDetailPage.tsx`
  - Fetch `event.rsvp_grouping` (already in `events.*` select).
  - When set, pass an extra `groupBy` prop into the attendance render path and build one section per group (using team lookups already fetched for club-wide events).
- `src/components/event/AttendanceSection.tsx` / `AttendanceRow.tsx` — accept an optional grouped structure and render group headers with counts; falls back to the current flat rendering when no grouping.
- Small helper `src/lib/rsvpGrouping.ts` — given `members` / `rsvps` and the grouping mode, return `Array<{ key, label, rows }>` sorted by age level then colour.

### Permissions
- The existing RLS on `events` already permits club_admin and committee_member with the events permission to insert club-scoped events. No policy change needed. The `is_club_admin` guard in the UI (`isClubAdminForSelectedClub`) will be extended to `isClubAdminOrCommitteeForSelectedClub` for showing the All Club option on games.

### Out of scope
- Notifications, reminders, and email templates remain untouched.
- No new mini_league or bracket features.
- No changes to game stats, captains, POTM, or goalkeeper wiring — those already tolerate absent team_id or are only shown when team_id is present.

## Verification
- Typecheck.
- New unit tests covering `rsvpGrouping.ts` bucket assembly and the "All Club + grouping" branch of the event validation guard.
- Playwright smoke: create a club-wide match with grouping = level, RSVP as two members from different age groups, confirm both appear under the correct group headers.
