# Fix: Remove Member does not revoke guardian-derived team/club access

## Confirmed root cause

`public.is_team_member(uid, team_id)` and `public.is_club_member(uid, club_id)` grant membership through THREE independent paths:

1. `user_roles` row scoped to the team/club
2. `children.parent_id` + `child_team_assignments` (biological/legal parent)
3. `child_guardians.guardian_id` + `child_team_assignments` (invited guardian)

The current "Remove Member" flow in `TeamDetailPage.tsx` (line 2668-2686) only deletes the scoped `user_roles` row. If the removed user is a guardian (or parent) of a child still assigned to that team, paths (2) or (3) keep returning `true`, so RLS on `events`, `rsvps`, chat groups, etc. still lets them read/write. Realtime channels stay valid until token refresh + membership re-check.

The same shortfall exists in `ChatParticipantsList.tsx` `removeMemberMutation` and any other direct `user_roles` deletes.

## Chosen permission model

**Keep the current three-path membership model** (it's load-bearing for the parent/guardian UX — parents legitimately access team events without their own `parent` role in some legacy data), but make removal **scoped and explicit**:

- Add a new SECURITY DEFINER RPC `public.remove_team_member(_team_id uuid, _user_id uuid)` that, in a single transaction:
  1. Authorises caller (`team_admin` of the team, `club_admin` of the team's club, or `app_admin`) — else raise.
  2. Deletes `user_roles` rows for `(_user_id, _team_id)`.
  3. For every child of `_user_id` (as `children.parent_id` OR `child_guardians.guardian_id`) that is assigned to `_team_id`: delete only the `child_team_assignments` row for that child+team. Guardian relationships and assignments to OTHER teams are preserved.
  4. Deletes any team-scoped `group_members` rows for `_user_id` in chat groups whose `team_id = _team_id`.
  5. Writes an `audit_logs` entry.
  6. Returns a summary `{ roles_removed, child_assignments_removed, group_memberships_removed }`.
- Add `public.remove_club_member(_club_id uuid, _user_id uuid)` mirroring the same shape at club scope (removes all user_roles for the club, all child_team_assignments to teams in that club for the user's children/guardianed children, all group_members in club-scoped groups). Used by existing club-level removal flows.
- **Do NOT** touch `child_guardians` rows — a guardianship is a person-to-person relationship that can span teams/clubs. Removing a guardian from one team must not sever their guardianship of the child in other contexts.
- **Do NOT** weaken `is_team_member` / `is_club_member` — other flows (parent-of-child access to a team they were never explicitly added to) rely on the derived paths.

Frontend removal entry points (`TeamDetailPage`, `ChatParticipantsList`, and any equivalent in club participant management) all call the new RPC — no direct `.delete()` on `user_roles` from client code for member removal.

## Data-migration implications

- No destructive backfill. The new RPC is forward-only; historical removals that left dangling `child_team_assignments` are surfaced by a **read-only** audit query the migration ships as a comment (not executed) so the operator can review and re-run removal per team.
- Report (not delete) rows where `user_roles` was deleted historically but a `child_team_assignments` still grants derived access to the same (user, team). These need human review — a legitimate co-parent may still belong.

## Affected frontend flows

- `src/pages/TeamDetailPage.tsx` (Remove Member confirm at ~2668) → call `remove_team_member` RPC.
- `src/components/chat/ChatParticipantsList.tsx` (`removeMemberMutation` ~157, `handleRemoveMember` ~614) → call the appropriate RPC based on group scope (team vs club vs manual group). Manual `group_members`-only groups keep the existing direct delete.
- `src/pages/TeamChatPage.tsx` remove path (~523) → same routing.
- Any club-participant removal UI → `remove_club_member`.

Guardian-management dialog (`ManageGuardiansDialog.removeGuardian`) is unchanged — that is intentionally a guardianship edit, not a team removal.

## Rollback strategy

- Migration is additive: two new RPCs + audit-log entries. No existing columns/functions modified.
- Rollback = `DROP FUNCTION` the two RPCs and revert the client changes. `user_roles`/`child_team_assignments` deletions performed by the RPC are the same shape the app already produces, so nothing to unwind at the data layer.

## Tests (Deliverable: acceptance criteria mapping)

Add:

- **DB-level (pgTAP-style via `supabase--read_query` fixtures in a new `src/edge-functions/removeMember.integration.test.ts` using a service-role client against the migration):**
  - Non-admin caller → RPC raises (AC 12).
  - Cross-club admin → raises (AC 13).
  - Guardian invitation acceptance creates exactly one scoped role + one guardian link (AC 2).
  - Before invite: guardian cannot read team events (AC 1).
  - After accept: guardian can read intended team, not another club (AC 3, 4).
  - After `remove_team_member`: `is_team_member` = false, guardian cannot read events, cannot insert RSVP (AC 5, 6, 7).
  - Guardian's access to an **unrelated** team of the same child is preserved (AC 9, "Access to unrelated teams is preserved").
  - `child_guardians` row is preserved (AC 10).
  - Repeated call is idempotent (AC 11).
  - Partial failure inside the RPC rolls back the whole transaction (AC 14) — simulated by wrapping in a `SAVEPOINT` test.
- **Frontend (`TeamDetailPage.removeMember.test.tsx`, `ChatParticipantsList.removeMember.test.tsx`):**
  - Clicking Remove Member invokes the RPC with correct args, shows success toast, and refreshes membership queries.
  - Error path surfaces toast, does not close the confirm.
- Realtime revocation (AC 8) is already covered by `useAuthorizedScopes` + `realtimeChannelRegistry` tests; add one case asserting a `remove_team_member` call invalidates the `authorized-scopes` query and triggers `revokeScope`.

## Why the fix cannot remove access from unrelated teams/clubs

The RPC filters every delete by `_team_id` (or `_club_id`) and by the target `_user_id`. `child_team_assignments` are joined through the removed user's children, and only rows with `team_id = _team_id` (or team's `club_id = _club_id`) are deleted. `child_guardians` is never touched. Other teams the guardian is legitimately linked to therefore still resolve `true` through `is_team_member`.

## Deliverables after implementation

- Migration adding `remove_team_member` + `remove_club_member` RPCs and audit hook.
- Production files changed: `TeamDetailPage.tsx`, `ChatParticipantsList.tsx`, `TeamChatPage.tsx` (removal call sites only).
- New tests listed above.
- Test results (target: all green, plus existing baseline unchanged).
- Report of historical `(user, team)` pairs where `user_roles` was removed but derived access remains — for operator review.
