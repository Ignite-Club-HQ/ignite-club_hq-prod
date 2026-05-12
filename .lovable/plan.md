## Goal

From the **Mini-League detail page**, allow club/league admins to invite people who aren't on the app yet — both **league admins** and **parents (with their kids as league players)** — using the same email + shareable join-link mechanics as team invites.

Two distinct invite kinds, both scoped to a mini-league rather than a team.

---

## Part 1 — League Admin Invites (small change)

Reuses existing infrastructure. League admins are stored in `mini_league_admins` (existing).

**Schema**
- `pending_invites`: add nullable `mini_league_id uuid references mini_leagues(id) on delete cascade`. Update `set_pending_invite_club_id` trigger so league-scoped rows still resolve `club_id` from the mini-league.
- `team_invites`: add nullable `mini_league_id uuid` and make `team_id` nullable. Add a CHECK that exactly one of `team_id` / `mini_league_id` is set. Keeps the same join-link table (so `/join/:token` keeps working).
- RLS: club admins + existing league admins can `select/insert/delete` league-scoped rows.

**Acceptance flow**
- Edge function `accept-team-invite` (or whichever handles `team_invites` redemption — confirmed during build): branch on `mini_league_id` → insert `mini_league_admins` row instead of `user_roles{team_id, role}`.
- `pending_invites` consumption (`accept-pending-invite` / on-signup reconciliation): same branch.
- `/join/:token` page: detect mini-league token, show "Join {leagueName} as League Admin" copy.

**UI**
- New `InviteLeagueAdminSheet.tsx` mounted from the existing **Manage** button in `MiniLeagueDetailPage`.
- Tabs: **Email invite** / **Share link** — matches `AddTeamMemberSheet` UX patterns.
- Email pending list is shown beneath current admins.

---

## Part 2 — Parent + Kids as League-Wide Players (larger change)

Mini-leagues currently have *teams* with players; there's no concept of league-direct players. We add one.

**Schema**
- New table `mini_league_players`:
  - `id uuid pk`
  - `mini_league_id uuid not null fk mini_leagues`
  - `child_id uuid null fk children` (for junior leagues)
  - `user_id uuid null fk auth.users` (for adult/senior players — same shape as team players)
  - `jersey_number int null`
  - `joined_at`, `created_at`
  - unique `(mini_league_id, child_id)` and `(mini_league_id, user_id)` partial indexes
- RLS:
  - select: any member of the league (via existing `is_mini_league_member` helper) + parents of the child + the user themselves
  - insert/delete: club admins, league admins, plus parent of the child (so they can self-remove)
- Extend `pending_invites.metadata` to support `kind: "mini_league_player_pool"` with `children: [...]` payload (same shape used today for team parent invites).
- `mini_league_id` on `pending_invites` from Part 1 covers scoping.

**Acceptance flow**
- Pending-invite consumer creates the parent's `user_roles` row at **club** level (`role=parent, club_id=...`), creates `children` rows, then for each child inserts a `mini_league_players` row.
- Adult/player invites insert one `mini_league_players(user_id=...)` row instead.

**UI**
- Same `InviteLeagueAdminSheet` becomes `InviteToMiniLeagueSheet` with a role tab: **League Admin** / **Parent + kids** / **Adult player**.
- Parent flow mirrors `AddTeamMemberSheet`'s child-add UI (collapsed, inline year-of-birth + jersey).
- Existing league members section on `MiniLeagueDetailPage` extended with a "League players" sub-section that lists `mini_league_players` rows.

**Read-side integration (intentionally minimal in this PR)**
- League players show up on the mini-league detail page only.
- They are **not** auto-rostered into team pitch boards, RSVPs or chats — those remain team-scoped. A follow-up PR can add "draft a league player onto a team" once you've used this for a season.

---

## Out of scope (call out explicitly)

- Wiring league players into team-level features (pitch board, RSVPs, team chat) — separate PR.
- Bulk CSV import for league invites — can copy from `MemberCSVImportDialog` later.
- League-level chat membership changes — handled by existing `useChatVisibilityRules`.

---

## Technical Details

- Tables touched: `pending_invites` (+col), `team_invites` (+col, relax `team_id`), new `mini_league_players`.
- Edge functions touched: `send-pending-invite-email`, `accept-pending-invite`, `accept-team-invite` (names verified during build), `notify-new-member-events` (skip when `mini_league_id` set — no team events yet).
- New components: `InviteToMiniLeagueSheet.tsx`, `MiniLeaguePlayersList.tsx`.
- Page edit: `MiniLeagueDetailPage.tsx` — replace Manage button with split actions: **Manage admins** + **Invite to league**.

---

## Suggested rollout

1. Migration (Part 1 schema) → ship admin invites (email + link).
2. Migration (Part 2 schema) → ship parent + kids invite + league players list.
3. Follow-up PR (later): expose league players inside team flows.

Confirm and I'll start with step 1.
