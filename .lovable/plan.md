# Referee and committee roles for competitions

Competitions currently have owners/admins (coordinators) and entered teams. This adds two more kinds of people, each with their own private chat.

## What the user gets

On a competition's settings page, a new **Referees & committee** section:

- Search people and assign them **Referee** or **Committee member**, remove them again, and see who currently holds each role.
- Only competition organisers (owner/admin) can assign or remove.
- Each person assigned gets a notification telling them which competition and role.

Two new automatic chats, listed in Messages next to the existing competition threads:

- **`<Competition> – Referees`** — every referee, plus competition owners/admins.
- **`<Competition> – Committee`** — every committee member, plus competition owners/admins.

Each thread is created the moment the first person is assigned to that role, keeps its members in step automatically as people are added or removed, and is hidden (history kept) when nobody holds the role. Renaming the competition renames both threads. Nobody outside those lists can see or read them.

## Technical approach

Database (DEV migration):

1. `competition_roles` check constraint: allow `committee` alongside existing `owner`/`admin`/`referee`/`scorer`.
2. `chat_groups.competition_scope` check constraint: allow `referees` and `committee` (existing values `coordinators`, `all_members` untouched). The unique index on `(competition_id, competition_scope)` already permits one group per scope.
3. New `ensure_competition_role_chat(_competition_id, _scope)` and `sync_competition_role_chat_members(_competition_id, _scope)`, mirroring the existing coordinator/member-chat pair:
   - members = `competition_roles` rows with role `owner`/`admin` UNION rows with the scope's role (`referee` or `committee`);
   - insert missing `group_members`, delete rows that no longer qualify;
   - group created as `membership_mode = 'manual'`, `allowed_roles = '{}'`, named `<name> – Referees` / `<name> – Committee`;
   - when no referee/committee rows remain, soft-delete the group (`deleted_at`), restore it on re-assignment.
   - `REVOKE ... FROM PUBLIC`, `GRANT EXECUTE ... TO service_role` as the existing functions do.
4. Extend `tg_competition_role_sync_chat` (already fires on every `competition_roles` insert/update/delete) to also ensure and sync the referee and committee chats.
5. Extend `tg_competition_rename_coord_chat` to rename the two new threads.
6. Access: `can_access_chat_group` already requires an explicit `group_members` row, so it works unchanged. `can_post_in_chat_group` is only restrictive for `all_members`, so referees/committee can post freely — no policy change needed.

Frontend:

- `src/features/competitions/competitionChatScope.ts`: add `referees` and `committee` to `CompetitionChatScope`, sublabels ("Competition chat · referees" / "· committee"), and keep `canPostInCompetitionChat` unrestricted for them. Extend `competitionChatScope.test.ts`.
- New `src/components/competitions/CompetitionOfficialsCard.tsx`: role assignment UI, reusing the search (`search_invitable_profiles`), add/remove mutations, and notification insert pattern from `CompetitionAdminsCard.tsx`, with a Referee/Committee segmented selector. Rendered from `CompetitionSettingsPage.tsx` below the admins card.
- `GroupChatPage.tsx`: treat the new scopes as competition groups for the header sublabel (existing `groupCompetitionScope` handling), no composer restriction.
- Messages list needs no change — the competition group query already fans out by `competition_id`; new threads appear via `group_members`.

## Out of scope

- Assigning a referee to a specific match/fixture (this is a competition-level role).
- Referee availability, payments, or match reports.
- Any change to the coordinators or All Members threads.
