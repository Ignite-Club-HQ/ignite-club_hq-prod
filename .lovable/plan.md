## Goal
Fix the two confirmed defects in club-wide `game`/`social` targeting (`events.target_team_ids`):

1. **Picker cannot be activated** — `TargetTeamsPicker` treats `[]` as "all club" so clicking "Only selected teams" from `null` immediately snaps back.
2. **Targeting is not an authorization boundary** — RLS on `events`/`rsvps`, series RPC, and notification/reminder fan-out do not honor `target_team_ids`. Non-targeted same-club members can see, open, RSVP, and receive reminders.

## Mode semantics (locked)
- `target_team_ids = NULL` → all eligible club members (all-club mode).
- `target_team_ids = []` or any array → selected-team **editing** mode. Submission requires `>= 2` distinct UUIDs; otherwise the frontend blocks with the existing warning.
- Single-team events must use `events.team_id` instead.
- Only `game` and `social` types can carry `target_team_ids`.

## 1. Frontend picker fix (`TargetTeamsPicker.tsx`)
- Change "active" from `value.length > 0` to `Array.isArray(value)`.
- "All club members" button → `onChange(null)`.
- "Only selected teams" button → `onChange(Array.isArray(value) ? value : [])` (opens checklist even when empty).
- Toggle logic: dedupe via `Set`, never mutate input, never fall back to `null` when the last team is removed (stay in selected-team mode with warning shown).
- Preserve `disabled` behavior.

## 2. Frontend guardrails
- `CreateEventPage` / `EditEventPage`:
  - Only submit `target_team_ids` when it is `null` **or** `length >= 2` (dedup + validate against club teams).
  - When team dropdown changes to a direct team, or type flips away from game/social, or `club_id` changes → clear `target_team_ids` to `null` in state.
  - EditEventPage: load existing target IDs; allow returning to all-club by submitting `null`.
  - Recurring create: pass the same `target_team_ids` to every child (already inherited by `inherit_parent_event_scope`; verify column is copied — add if missing).
  - Entire-series edit: send `target_team_ids` through `update_event_series` (already whitelisted in prior migration; verify).
- `EventDetailPage`: continue passing target IDs to grouped attendance; **remove client-side visibility gating** — rely on backend.
- Query-cache keys: include the current user's club/team membership already; targeted events naturally disappear when RLS excludes them, so no key changes required for cross-user leakage. Confirm no `events` list query is loaded with a service-role-like path.

## 3. Backend — new forward-only migration
Create `supabase/migrations/<ts>_targeted_events_authorization.sql`. Forward-only; no edits to deployed migrations.

**Validation trigger** (replace/extend existing `validate_event_target_team_ids`):
- `target_team_ids IS NULL` → allowed.
- Otherwise: `array_length >= 2`, all elements distinct, all elements exist in `public.teams` with `club_id = events.club_id`, `events.team_id IS NULL`, `events.type IN ('game','social')`.
- Normalize empty array to NULL, or reject (choose reject — clearer contract; frontend never submits `[]`).
- Fires on INSERT and on UPDATE of `club_id`, `team_id`, `type`, `target_team_ids` (revalidates whole relationship).

**Recurring inheritance**: ensure `inherit_parent_event_scope` copies `target_team_ids` to child rows on generation (add if missing).

**SECURITY DEFINER helper** `public.can_access_targeted_event(_user_id uuid, _event_id uuid) returns boolean`:
- `SET search_path = public`, `REVOKE EXECUTE FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`.
- Returns true when any of:
  - app admin
  - club admin / committee member for `events.club_id` (via existing helpers)
  - `events.target_team_ids IS NULL` **and** user is an eligible club member (reuse existing club-visibility helper)
  - `events.target_team_ids` overlaps user's team memberships (player/coach/team admin) via existing membership helpers
  - user is an authorized guardian of a child assigned to any targeted team (reuse existing guardian helper — no new definitions)
- No arbitrary membership enumeration; scoped strictly to `_user_id`, `events.club_id`, and target teams.

**RLS updates** (audit + adjust — never weaken existing protections):
- `events` SELECT: for rows where `target_team_ids IS NOT NULL`, require `can_access_targeted_event(auth.uid(), id)`. Rows where it's NULL keep current behavior.
- `events` INSERT/UPDATE: unchanged managerial checks; validation trigger enforces the shape.
- `rsvps` SELECT/INSERT/UPDATE: for RSVPs referencing a targeted event, require `can_access_targeted_event(auth.uid(), event_id)` in addition to existing ownership/guardian rules. Child RSVP creation/update uses the same helper on behalf of the guardian's authorized child.
- `update_event_series` RPC: already whitelists `target_team_ids`; add per-caller authorization check reusing existing "can manage event" helper (no change to signature).

## 4. Notifications & reminders
Audit and constrain recipient selection everywhere a club-wide event fan-out is built:
- Event-created notifications, RSVP reminders, attendance reminders, event digest emails, push fan-out.
- Recipient query: when `event.target_team_ids IS NOT NULL`, restrict to union of (targeted-team members, authorized guardians of children in targeted teams, event managers/admins). Non-targeted club members receive nothing (no title/time/location/deep-link leakage).
- Changing target teams must not leave scheduled/queued reminders addressed to removed users — invalidate/reselect at send time (recompute recipients from live `target_team_ids` rather than using stored recipient snapshots). Do not delete historical notifications.

## 5. Tests

**Unit (vitest):**
- `src/components/event/TargetTeamsPicker.test.tsx` (new): 7 required cases —
  1. From `null`, clicking "Only selected teams" opens checklist with `value=[]`.
  2. Warning shown while `< 2` selected.
  3. Selecting a second team fires `onChange([id1,id2])` with unique IDs.
  4. Clicking "All club members" fires `onChange(null)`.
  5. No mutation of input array.
  6. Duplicate IDs never emitted.
  7. `disabled` blocks interaction.
- `src/components/event/ClubWideRsvpBreakdown.test.tsx`: verify grouped attendance excludes non-targeted teams when `target_team_ids` provided.

**Playwright baseline** (`e2e-baseline/club-wide-game-rsvp.spec.ts` on `playwright.baseline.config.ts`, isolated local only — do not point at hosted dev/prod):
1. Create targeted club-wide game for U8 Blue + U8 Red.
2. Edit audience to U8 Blue + U10 Red; PATCH must include replacement `target_team_ids`.
3. Detail page excludes U8 Red after edit.
4. Non-targeted same-club member cannot open the detail page.
5. Non-targeted same-club member cannot POST an RSVP (backend rejects).

Commands (documented, do not wire to hosted envs):
```
npx vitest run \
  src/components/event/TargetTeamsPicker.test.tsx \
  src/components/event/ClubWideRsvpBreakdown.test.tsx

npx playwright test \
  --config playwright.baseline.config.ts \
  e2e-baseline/club-wide-game-rsvp.spec.ts
```

## Do NOT
- No frontend-only visibility fix.
- No weakening of existing club/team/guardian/cross-club RLS.
- No `USING (true)` policies; no service-role exposure.
- No destructive data cleanup; no deletion of real events/RSVPs/roles/assignments.
- No `promote-guard` allow markers unless a reviewed protected UPDATE is genuinely unavoidable.
- No test edits to match incorrect behavior.
- No use of real club/user data in tests.

## Files touched (approx)
- 1 new migration (`supabase/migrations/<ts>_targeted_events_authorization.sql`)
- `src/components/event/TargetTeamsPicker.tsx`
- `src/pages/CreateEventPage.tsx`, `src/pages/EditEventPage.tsx`, `src/pages/EventDetailPage.tsx`
- New: `TargetTeamsPicker.test.tsx`, `ClubWideRsvpBreakdown.test.tsx`, `e2e-baseline/club-wide-game-rsvp.spec.ts`
- Recipient-selection audit patches in relevant Edge Functions / SQL functions (send-event-*, reminders)

## Verification
- `tsgo` clean.
- All new + existing vitest suites pass.
- Playwright baseline journey passes.
- Manual sanity: creating a targeted event as a non-targeted user surfaces zero rows via PostgREST; RSVP POST returns RLS error.
