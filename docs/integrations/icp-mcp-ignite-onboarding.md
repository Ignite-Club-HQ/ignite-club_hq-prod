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

## Disposable rehearsal evidence

The CI job `rehearse-onboarding` in `.github/workflows/test-icp-mcp-onboarding.yml` uses PocketIC with two **synthetic, separate user principals** and one unrelated outsider, compiled from the feature branch. Its `frontend/scripts/test-icp-mcp-onboarding-replica.mjs` checks:

- Fresh `whoami` refusal before `register_account`, account registration idempotency and separate caller accounts.
- Missing profile and terms before explicit per-user updates; persisted display names and terms acceptance.
- Owner-created club, duplicate-ID refusal, club ownership and `AU` home-country record.
- Full team creation and readback, random team invitation link, public token preview, independent parent joining and idempotent acceptance.
- Foreign caller denied club-team edits and invite minting; personal team created by owner but its normal invite path denied.
- Disposal of the complete local PocketIC environment, with no live credentials, network deployment or live member changes.

This proves a **local subset of the current canister behavior**, not a first-use ChatGPT plugin experience, group-placement end-to-end behavior, encrypted-name secure release, current policy version or native-app onboarding. It does not authorize production release.

## Branded app links and paid plans

When an onboarding customer has created or joined their team, display the three **production-branded links** (regardless of whether ChatGPT is operating against DEV):

| Customer intent | Visible link |
| --- | --- |
| Continue in browser | https://igniteclubhq.app |
| Download for iPhone | https://igniteclubhq.app/get/ios |
| Download for Android | https://igniteclubhq.app/get/android |

The short app-store links are fixed HTTP 302 routes in the root `netlify.toml` **ahead of the fallback wildcard proxy**. The iPhone route targets the verified Apple ID `6758928691`. The Android route targets Google Play package `app.lovable.igniteteamhub`. Neither full destination is shown in customer-facing onboarding copy; the Google Play destination URL still exposes the historical package name **after redirect**, which cannot be removed without a new package/app listing. The links must be tested on the live branded domain after deployment, because the feature branch alone does not publish them.

Keep signup invitations/deep links separate from store download links. Do not shorten or rewrite the authentication derivation origin or store arbitrary redirects. Never insert invite bearer tokens into store URLs or public link-shortener logs. If a customer started in ChatGPT/DEV, explain that the production app is a different environment: a DEV account or test team will not automatically appear on PROD.

### Pro purchases initiated during a ChatGPT conversation

**Do not charge inside ChatGPT, suggest a fabricated payment URL, or promise Pro entitlement.** The current supported pattern is a handoff to the app's verified subscription screen and a post-purchase recheck:

1. Ask whether they want a **team** or **club** plan, Pro or Pro Football, and the number of teams, billing cadence and country. Use only current configured prices and approved products; never invent a promotional price or offer.
2. Prefer **Free onboarding first**. A plan quote/choice does not confer Pro. For an existing, authorised club/team use the exact entity route `https://igniteclubhq.app/clubs/<actual-club-id>/upgrade` or `https://igniteclubhq.app/teams/<actual-team-id>/upgrade`. These are deep links, not public checkout URLs; show them only for real **PROD** IDs. DEV IDs cannot be used on the PROD domain.
3. The current Internet Identity (ICP) **web** upgrade paths explicitly block Stripe/card checkout. **Native** Apple/Google purchase paths use store billing, receipt verification via `verify-iap-receipt-icp`, and attestation redemption on `identity_access`; they require a store-configured product, a valid receipt and account identity. No current `ignite_v2_` products pass the code's `assertPurchaseCatalogReady(productId, [])` guard, so don't market these new plans as purchase-ready.
4. On successful external payment, billing and receipts are managed by Ignite's payment provider. Requery the authoritative plan entitlement/subscription status before saying that Pro is active. If checkout is declined or interrupted, preserve the Free account and offer a retry in the appropriate native app.
5. For existing Supabase/email accounts, the **web Stripe** `create-subscription-checkout` flow is separate from ICP. Do not route an Internet Identity customer into the email-only checkout or substitute a Supabase entitlement. No card details, transaction IDs, or receipt bodies are requested by ChatGPT.

**Store rules:** Apple and Google generally require approved in-app billing for qualifying digital features in native apps, subject to regional exceptions and enrolled programs. Do not add an unapproved link to Stripe inside native iOS/Android. An external checkout originating outside a native app still needs account/entitlement reconciliation, subscription terms, refund and tax handling.

Current developer policy references: https://developers.openai.com/plugins/build/monetization , https://developer.apple.com/app-store/review/guidelines/ , https://support.google.com/googleplay/android-developer/answer/9858738 .

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
