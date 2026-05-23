# Self-Join for Operations & Volunteers Groups

Add WhatsApp-style self-join to club chat groups whose `category` is `Operations` or `Volunteers`. All other groups remain invite-only.

## Scope guardrails
- Only club-scoped groups (`club_id IS NOT NULL`, `team_id IS NULL`, `mini_league_id IS NULL`) qualify.
- Only categories `Operations` and `Volunteers` qualify. Personal/team/league groups untouched.
- User must already be a member of the parent club. No cross-club joining.
- Critical: never set `chat_groups.club_id` on a personal group to attach it (per existing memory) — we only flip a new `join_policy` flag.

## Database changes (single migration)

1. `chat_groups.join_policy` enum: `'invite_only' | 'open_to_club'`, default `'invite_only'`.
2. Backfill: set `join_policy = 'open_to_club'` where `club_id IS NOT NULL` AND `category IN ('Operations','Volunteers')` AND `membership_mode != 'manual'` is irrelevant — apply regardless of mode since the category is the signal.
3. BEFORE INSERT/UPDATE trigger on `chat_groups`: if `category IN ('Operations','Volunteers')` and `club_id IS NOT NULL`, default `join_policy` to `'open_to_club'` when not explicitly set. If category changes away, reset to `'invite_only'`.
4. SECURITY DEFINER function `public.join_open_chat_group(_group_id uuid)`:
   - Verifies group exists, is club-scoped, `join_policy = 'open_to_club'`, category is Operations/Volunteers.
   - Verifies caller is an active member of that club (any role).
   - Verifies caller is not already a member.
   - Inserts into `chat_group_members` with role `member`.
   - Returns the new membership row id.
5. RLS read policy addition on `chat_groups`: allow SELECT for users who are members of `club_id` when `join_policy = 'open_to_club'` (so Discover list can fetch them even when user is not yet a member). Existing member-only policies stay.
6. Optional Phase 2 (NOT in this build): `chat_group_invites` token table for Option 2 share links. Defer until Option 1 is validated.

## Frontend changes

### A. Discover section on Messages page
- New component `src/components/chat/DiscoverGroupsList.tsx`.
- Query: club-scoped groups where `join_policy='open_to_club'` AND user is not already in `chat_group_members`. Group by club, show category badge.
- Each row: group name, category chip, member count, "Join" button.
- Tap Join → call `join_open_chat_group` RPC → optimistic add → navigate to group, or toast and refresh inbox.
- Place under existing inbox list, collapsed by default with header "Discover groups" + count. Empty → hide section entirely.

### B. Group creation/edit toggle
- In `CreateGroupDialog` and `EditGroupDialog`: when category is Operations or Volunteers and group is club-scoped, show a toggle "Let any club member join" (defaults ON for those categories, OFF otherwise). Persists `join_policy`.
- Hide toggle for team/league/personal groups.

### C. Group header indicator
- In `GroupChatPage` header: small "Open to club" pill when `join_policy='open_to_club'` so members understand others can self-join.

### D. System message on join (lightweight)
- Use existing system message pattern. Post "{name} joined" only for open-to-club self-joins to keep parity with normal add flows. (Existing add flow already posts a similar event; reuse it.)

## Out of scope for this round
- Share-links (Option 2) — defer.
- Approval workflow (Option 3) — defer.
- Locking category to enum — keep free-text; rule enforced via DB trigger.
- Auto-leave on club departure — already handled by existing club-leave cleanup.

## Files touched
- New migration (chat_groups column + trigger + RPC + RLS policy).
- `src/components/chat/DiscoverGroupsList.tsx` (new).
- `src/pages/MessagesPage.tsx` (mount Discover section).
- `src/components/chat/CreateGroupDialog.tsx` (toggle).
- `src/components/chat/EditGroupDialog.tsx` (toggle).
- `src/pages/GroupChatPage.tsx` (header pill).

## Rollout
1. Ship migration → verify backfill counts.
2. Ship UI → manual QA: non-member sees group in Discover, can join, lands in chat, sees history.
3. Verify invite-only groups never appear in Discover for non-members.
