---
name: Team join link tokens
description: Persistent shareable team join links — defaults, storage, and UI placement rules
type: feature
---
Team join links are persistent shareable invites for parents:
- Stored as a row in the existing `team_invites` table with `metadata = { kind: 'team_join_link' }` (no separate table).
- Defaults: 30-day expiry, `max_uses = NULL` (unlimited), `role = 'parent'`.
- Coexist with one-off invites — never replace them. One-off remains the primary CTA for known recipients; join link is the broadcast option.
- Surfaced via `<TeamJoinLinkCard />` at the top of `AddTeamMemberSheet` (visible only when `canBulkInvite`).
- Joining flows through the existing `/join/:token` page + `get_team_invite_by_token` RPC — no new edge function required.
- Regenerate = delete prior row + insert new; Revoke = delete row.
