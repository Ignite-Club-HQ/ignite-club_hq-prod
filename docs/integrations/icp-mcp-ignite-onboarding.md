# Ignite Club HQ onboarding through DFINITY ICP MCP

Status: implementation guidance / DEV validation, **not** proof of a successful new-user registration. No new MCP server or separate OAuth provider is needed. The existing ICP connector uses the app's published `/.well-known/ic-architecture` manifest and Internet Identity delegation to call declared canisters with the user's permissions.

## Verified environments

| Environment | Application URL | Branch | Notes |
| --- | --- | --- | --- |
| DEV | https://ignite-club-launchpad.lovable.app | `main` | Use for all onboarding tests; its derivation origin resolves separately via `open_app`. |
| PROD | https://igniteclubhq.app | `prod` | Different II derivation origin and canister IDs. No production onboarding tests or writes without explicit approval. |

**Always use `open_app` with the exact user-supplied URL**. ICP MCP cannot find Ignite by the bare name. Never invent canister IDs, target aliases, or derivation origins and never swap DEV/PROD principals. Users must authorise their own II access; the app-admin identity used by a developer is not a proxy for a new coach.

## Account setup: existing operations

1. Discover Ignite's manifest and the identity_access/club_domain/shard_router Candid interfaces. Read `club_domain.getApiDoc()`.
2. Connect the user's Internet Identity using the app's returned derivation origin and appropriate action authorisation.
3. Query `identity_access.whoami()` first. If the account is missing, obtain the user's agreement before calling `register_account()`. Do not register someone else or call it just to probe permissions.
4. Query `identity_access.get_profile()`. With the user's chosen display name, use the existing guarded name/profile setup; the frontend already handles private-name authority requirements. A plain `set_profile` may fail where secure-name saving is enforced. **Prefer finishing the name through Ignite's app** until the plugin can complete the identical privacy-preserving flow.
5. Check `identity_access.my_terms_acceptance()`; show the actual current terms and privacy information and obtain explicit consent before `set_terms_acceptance(version)`. A missing or outdated version is not consent. Do not guess the current terms version.
6. After registration and profile setup, verify the account and profile again. Club-domain account linking may lag or fail independently; do not assume an identity update provisioned every domain.

An II account is **not** a fully onboarded Ignite account until its required profile and legal acceptance are complete.

## Club administrator creates a club and team

1. Ask whether the organisation already exists and whether the user is its administrator. Use public directory reads to avoid duplicate clubs; a name match alone never grants ownership.
2. Ask for name, sport, home country and proposed team name/age group. Confirm the intended new club before submitting a state-changing call.
3. The app currently creates a unique opaque club ID and uses `create_club(id,name,slug,description,?sport)`. The canister grants the creating principal `club_admin`. If the app has activated general/group placement, its dispatcher calls the shard_router first and writes to the assigned club_domain with a creator-bound placement receipt. **Do not call a shared club_domain as a fallback if placement is active or uncertain.** Use the built-in Ignite club creation screen instead if the declared canisters do not permit the correct routed write.
4. The app also performs follow-up setup (home country, optional class settings, default chats and media). Directly calling `create_club` skips that application setup. Until the agent can verify all follow-ups, tell the user to finish club setup in Ignite rather than claiming it is complete.
5. For a verified owned club, `save_team(ClubTeam)` expects the **full** Candid record, not only a name, ID and club ID. Mirror the existing CreateTeamPage defaults, confirm club membership and team limit, then verify the created team ID via `get_team`.
6. `create_team_invite_link(clubId,teamId,role)` can create new rotating-token links. Approved roles are `player`, `parent`, `coach`, `team_admin`; the canister applies per-role permission checks. Request user confirmation before creating a link. Present `<app URL>/join/<encoded token>` for the same environment only. Link creation does not itself email anyone.
7. Only report success after reading the committed club/team results. If an update response is lost, **do not blindly retry**. First read by the original ID or list the existing invite links under authorised access. A second invitation call could create a new token.

## Coach starts a personal team

The existing `save_team` accepts a *clubless* personal team with `club_id = ""`; the creator becomes the recorded personal-team owner and `list_my_personal_teams()` can list their own teams. The standard UI uses this route.

**Current blocker:** `create_team_invite_link` checks club/team ACL roles and does not recognise personal-team ownership. The personal team can be created, but the normal team invitation workflow must **not** be advertised as working for a clubless team. This also needs a deliberate join/roster design, not just a bypass in the link-minting guard. Do not make unrelated clubs or personal team data publicly writable as a workaround.

For now, the complete ChatGPT pilot should focus on a regular club and team, or route personal-team owners to the Ignite UI without promising invitations.

## ICP MCP read/query contract

- `club_domain.schema()` exposes the Ignite read-only OQL grammar. Use `{"entity":"clubs","select":["id","name"],"limit":50}` and `{"entity":"teams","select":["id","name","club_id"],"limit":50}` (not the generic connector example with `start`; the Ignite canister rejects that field).
- OQL data is caller-scoped. Public Candid directory reads may have a different visibility scope; never treat a directory match as authorisation to mutate.
- Query `schema` and `getApiDoc` before guessing field names, Candid types or permissions.
- Ask for explicit approval for all writes; never silently create additional clubs, users or invitations.

## DEV acceptance test — use a fresh, non-admin identity

These are **pending manual, permissioned** tests; the current developer account passing `whoami` and `get_profile` does **not** prove new-user onboarding:

- [ ] On a new II principal, confirm `whoami` indicates no account and register once with the user's consent.
- [ ] Verify profile and legal terms through the same privacy-preserving workflow used by the app.
- [ ] Verify standard club creation including group placement, ownership, home country and default chat setup, **without direct writes to the wrong group**.
- [ ] Create one club-owned team with the full Candid record, respecting subscription limits.
- [ ] Create one appropriate team invite and open its `/join/<token>` URL as a separate non-admin test identity.
- [ ] Check that team invites for unauthorised principals fail; confirm no admin privilege escalation.
- [ ] Simulate an interrupted creation reply and reconcile by original ID instead of repeating the update.
- [ ] Test personal team separately and document invitation behaviour before advertising it.
- [ ] Verify DEV and PROD IDs/principals remain isolated and that Supabase/email signup is unchanged.
- [ ] Obtain owner review before promoting a canister upgrade; never merge this PR directly to `prod`.

## Scope

This work improves the **existing** canister's discoverability/behavior documentation and adds regression guidance. It does **not** install another ChatGPT plugin, modify `/.well-known/ic-architecture`, enable a new routing group, grant roles, deploy canisters, create customer accounts or alter the Lovable website.

Source: `backend/club_domain/src/main.mo`, `backend/identity_access/src/lib.rs`, `frontend/src/pages/CreateClubPage.tsx`, `frontend/src/pages/CreateTeamPage.tsx`, `frontend/src/pages/JoinTeamPage.tsx`, `frontend/src/live/groupDispatch.ts`.

DFINITY reference: https://docs.internetcomputer.org/guides/frontends/service-discoverability/ .
