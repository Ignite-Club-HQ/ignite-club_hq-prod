# Competition-wide chat ("All Members")

Today a competition entry only grants access to one thread: `<Competition> – Coordinators` (competition owners/admins + team admins of entered teams). This plan adds an optional second thread that everyone connected to an entered team can use.

## What the user gets

- Each competition can have an **All Members** chat: `<Competition> – All Members`.
- Anyone with a role on an entered team (team admins, coaches, players, parents/guardians) plus competition owners/admins is a member.
- It is **opt-in per competition**: a toggle on the competition settings page ("Enable competition-wide chat"). Off by default so existing competitions don't suddenly gain a large chat.
- Competition admins can post announcements; a "read-only for members" option lets admins broadcast without a free-for-all (default: everyone can post).
- Appears in Messages alongside the Coordinators thread, with the same unread badges, mute, and club filtering behaviour.

## Structural change to be aware of

The database currently assumes **one chat group per competition** (lookups are `chat_groups WHERE competition_id = X`). Supporting two threads requires a discriminator, so this is the main non-trivial piece of work.

## Technical approach

1. **Schema**
   - Add `chat_groups.competition_scope text` with values `coordinators` / `all_members`; backfill existing rows to `coordinators`; unique index on `(competition_id, competition_scope)`.
   - Add `competitions.member_chat_enabled boolean not null default false` and `competitions.member_chat_admins_only boolean not null default false`.
2. **Membership sync (migration)**
   - Update `ensure_competition_coord_chat` / `sync_competition_coord_chat_members` to filter on `competition_scope = 'coordinators'` so existing behaviour is untouched.
   - New `ensure_competition_member_chat(_competition_id)` and `sync_competition_member_chat_members(_competition_id)`: members = competition_roles(owner|admin) UNION every `user_roles.user_id` for teams with an entry in (`invited`,`accepted`) — any role, not just `team_admin`. Same add/remove pattern.
   - Extend the existing entry trigger and generalise the `user_roles` trigger (currently only reacts to `team_admin`) to resync the member chat for any team role change. Toggling `member_chat_enabled` creates/seeds the group; turning it off hides the group rather than deleting history.
   - Rename trigger updates both group names.
3. **Access + posting rules**
   - `can_access_chat_group` already requires explicit `group_members` rows, so it works unchanged.
   - Message INSERT policy for the group respects `member_chat_admins_only` (only competition owner/admin may post when set).
4. **Frontend**
   - Competition settings: toggle for the member chat plus the admins-only switch.
   - `MessagesPage.tsx`: the competition group query already fans out by `competition_id`; add scope-aware labelling/icon so the two threads are distinguishable, and keep club-filter behaviour (visible when the club has an entered team).
   - `GroupChatPage.tsx`: treat `competition_scope = 'all_members'` as a competition group (header, members list, composer disabled when admins-only and the user isn't an admin).
5. **Notifications**: reuse the existing group-message push path; no new fan-out code. Because this thread can be large, respect existing mute preferences and default new members to normal (not forced) notifications.
6. **Tests**: membership-rule tests (player/parent on entered team gains access; withdrawal removes access; disabled competition grants nothing) plus an admins-only posting guard test.

## Out of scope

- Per-division or per-team sub-threads within a competition.
- Cross-competition or spectator/public access.
