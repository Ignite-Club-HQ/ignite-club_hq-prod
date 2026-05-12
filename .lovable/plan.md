## Goal
Bring the mini-league "Add Players" sheet to parity with the team invite flow: a prominent shareable parent join link (one tap → joiner becomes parent + adds their kid → kid auto-assigned to the league) sitting above the existing named/email invite form.

## Scope

### 1. New component — `MiniLeagueParentJoinLinkCard`
Mirrors the new `MiniLeagueAdminJoinLinkCard`:
- Icon + title "Share a parent join link", subtitle explaining one link per league
- No "sensitive role" warning (parent is safe to share)
- Share / Copy / QR + Regenerate / Revoke
- Backed by a single `pending_invites` row with `metadata.kind = 'mini_league_parent_join_link'`, `role = 'parent'`, `invited_email = NULL`, `invited_label = NULL`, `metadata.mini_league_id`
- URL pattern: `https://igniteclubhq.app/join/p/<token>` (same as admin link)

### 2. `JoinTeamPage` updates (`src/pages/JoinTeamPage.tsx`)
- Skip name-match validation when `metadata.kind === 'mini_league_parent_join_link'` (no per-recipient name on a shareable link)
- Skip "invite already used" check for that kind
- Re-enable the `showChildStep` UI for league shareable links: gate the existing child-add flow on `metadata.mini_league_id` (currently gated on `invite?.team_id`)
- After joiner adds a child:
  - Insert into `children` with `parent_id = user.id`
  - Insert into `child_mini_league_assignments` (idempotent, default ability 3)
- Do NOT mark the invite accepted (keep token reusable, same pattern as the league_admin link)
- Issue `parent` role grant at the club level if not already present

### 3. `AddMiniLeagueMemberSheet` integration
Mount `MiniLeagueParentJoinLinkCard` at the very top of the sheet (above the Single/Bulk tabs), so it is the primary CTA. The named/email "Add Player" tabs stay unchanged underneath — these remain the way to pre-create a kid record and invite a specific parent by email.

## Out of scope
- Team-side changes (already supports parent + child shareable links)
- Bulk import changes
- Adding shareable links to specific *children* (only the parent-with-own-child flow)
- Any change to `mini_league_players` legacy table — child assignment is via `child_mini_league_assignments` only

## Files touched
- New: `src/components/mini-league/MiniLeagueParentJoinLinkCard.tsx`
- Edit: `src/pages/JoinTeamPage.tsx` (validation + child step gating + accept skip + role grant for league parent link)
- Edit: `src/components/AddMiniLeagueMemberSheet.tsx` (mount the card above the tabs)

No DB migration needed — the existing pending_invites RLS policy for league-scoped admins already covers insert/select via `metadata->>'mini_league_id'`.