## Goal
Extend the club-wide game feature so a creator can target **a subset of teams** (2+) instead of only one team or the entire club. Members of the targeted teams see and can RSVP; other club members do not.

## User flow
1. In Create/Edit Event, when type = **Game** and the Team dropdown is set to **All Club**, a new **"Target specific teams"** control appears.
2. Options:
   - **All club members** (current club-wide behaviour — no restriction)
   - **Only selected teams** — reveals a multi-select of teams in the club
3. When 2+ teams are selected, only members of those teams (and the players/guardians tied to them) see the event on Home/Schedule and can RSVP.
4. The existing RSVP grouping control (None / by level / by team) is still shown; the creator picks the grouping. Grouping by team will use the targeted teams as the sections.

## Scope guardrails
- Only **games** (and socials that already support All Club) can use multi-team targeting.
- Requires `team_id IS NULL` and `>=2` teams selected. 1 team = pick that team directly; all teams = same as "All club members".
- No change to RLS SELECT for now — visibility is enforced in the client filters (matches how `restricted_to_roles` already works). Documented as a follow-up hardening step.
- Existing club-wide events (no target list) behave identically to today.

## Technical details

### Database (single migration)
- Add column `events.target_team_ids uuid[]` (nullable).
- Validation trigger `validate_event_target_team_ids`:
  - If `target_team_ids IS NOT NULL`:
    - `team_id` must be NULL
    - `type` must be `'game'` or `'social'`
    - Array length >= 1
    - Every team in the array must have `club_id = events.club_id`
- Extend `inherit_parent_event_scope` to also copy `target_team_ids` to recurring children.
- Extend the `update_event_series` allowed-columns whitelist to include `target_team_ids` (and, as a bug-fix noticed while auditing, `rsvp_grouping`).
- Guard-friendly: no destructive statements.

### Frontend
- `src/pages/CreateEventPage.tsx` & `src/pages/EditEventPage.tsx`
  - New state `targetTeamIds: string[]`.
  - When `!teamId && type === "game" | "social"`: show a "Target" segmented control (All club members / Only selected teams). Selecting the latter reveals a chip-multiselect of `teams` in the club.
  - Guard on submit: if "Only selected teams" chosen, require >= 1 team; if all teams are picked, coerce back to `null` (equivalent to All Club).
  - Persist `target_team_ids` on insert/update.
- `src/components/event/TargetTeamsPicker.tsx` (new) — reusable multi-select of teams (uses `MobileCardSelect` styling / chips).
- `src/pages/EventDetailPage.tsx`
  - When `event.target_team_ids` is set: filter the attendance list to members of those teams (uses the same team → members lookups already loaded for grouping).
  - Access gate for the RSVP action: hide RSVP UI for users not in any targeted team (mirrors the current `restricted_to_roles` gate pattern at lines 939/2070/2266/3599).
- `src/lib/rsvpGrouping.ts` — when `target_team_ids` is present and grouping = `team`, restrict sections to targeted teams.
- Schedule/Home event lists — apply the same client-side filter so non-targeted members don't see the event card (helper in `src/lib/eventVisibility.ts`, colocated with the existing `restricted_to_roles` filter).

### Permissions
- Same as All Club today: `club_admin` + `committee_member` with events permission (unchanged).

### Out of scope
- RLS-level enforcement of `target_team_ids` (follow-up; today the pattern matches `restricted_to_roles`, which is client-enforced).
- Notifications targeting — reuse the existing club-wide fan-out; recipients who can't see the event simply won't get a card in-app. Push filtering hardening is a follow-up.
- Training remains team-only.

## Verification
- `tsgo` typecheck.
- Unit tests:
  - Validation trigger: rejects cross-club team in `target_team_ids`, rejects when `team_id` is set, rejects for training.
  - `eventVisibility.ts`: member of a targeted team → visible; non-member → hidden; club admin → visible.
- Playwright smoke: create All Club game targeting 2 teams; a member of team A sees + RSVPs; a member of team C (not targeted) does not see it.

## Files touched (approx)
- 1 migration
- CreateEventPage.tsx, EditEventPage.tsx, EventDetailPage.tsx
- New: TargetTeamsPicker.tsx, eventVisibility.ts
- rsvpGrouping.ts (extension)
- Home/Schedule event-list filter call sites (~2 lines each)