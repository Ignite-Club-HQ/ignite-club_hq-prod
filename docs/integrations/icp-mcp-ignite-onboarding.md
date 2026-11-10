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

### Production website signup, payments and subscription reconciliation

**Owner-confirmed architecture (11 Nov 2026):** https://igniteclubhq.com uses Internet Identity and connects directly to the **PROD club canister**. Creating a club on the website writes the production club record. This is **not a separate Supabase/email account or an unlinked external club database**. Do not propose creating another website identity, manual account linking, or migrating clubs from the website into ICP as a default.

**Owner-confirmed payments and entitlement integration (11 Nov 2026):** igniteclubhq.com uses **Stripe** for paid signup. **The website and app are already integrated: when a Stripe payment succeeds, the existing membership subscription is updated and recognised by Ignite.** This is an existing production workflow, not an integration that ChatGPT onboarding should replace. Club creation and website sign-in already use Internet Identity and the production club canister. Do not create a duplicate club, a second account, or an additional website-to-ICP payment bridge.

**Still to independently validate for ChatGPT use:** exact .com registration and checkout destinations; matching the authenticated production principal and club ID; which read-only canister subscription/entitlement method reflects the membership after Stripe processing; and whether renewal, cancellation and refund transitions appear correctly to the plugin. These are plugin interoperability checks, **not a claim that the existing Stripe-to-app membership synchronization is missing**. Do not invent Stripe URLs or attempt a charge to verify.

**User journey:**
1. Customer consents and authenticates through Internet Identity. Verify that the identity seen by ChatGPT is the same **effective principal** that the production website uses. Matching a displayed name or email is insufficient. For a DEV plugin identity, do not create records on PROD or treat the two derivation origins as interchangeable.
2. ChatGPT can help register a Free account and create a club/team on the selected environment through the already available ICP canisters, with explicit permission and safe placement. Alternatively the customer can self-serve Free signup on the production website. **Do not create the same club through both paths**; read the existing club ID/ownership first.
3. Customer may separately use the website's own Pro/billing journey outside the plugin. Use the website's **existing Stripe signup and subscription handling** without making another membership writer. Its current verified-payment process updates membership in the app; do not replay or independently activate a Pro subscription from ChatGPT. Never trust the Stripe success redirect alone as payment proof.
4. When the customer has **already purchased independently on igniteclubhq.com**, ChatGPT may read the app's **updated membership subscription** for the authenticated production club/team and report its current plan. Read-back must succeed before claiming Pro; a redirect or screenshot is not an entitlement.
5. Return the brand-owned app links `https://igniteclubhq.app/get/ios`, `https://igniteclubhq.app/get/android` and `https://igniteclubhq.app` as optional install/access destinations. The website `https://igniteclubhq.com` is the public information site. Never display a Lovable project URL or expose raw store package IDs in customer-facing copy.

### Existing website plan selection and 30-day trials

**Owner-confirmed existing production experience (11 Nov 2026):** The website https://igniteclubhq.com **already** asks customers to select or compare plans, shows the features for each plan, and offers **30-day trials for eligible paid subscriptions**. It uses Internet Identity for signup and the existing **Stripe** payment workflow; the website and app are integrated, so subscription updates are reflected in the existing membership subscription. **Do not build a second plan-selection screen, trial-creation service, Stripe checkout, webhook, billing writer, or membership database as part of ChatGPT onboarding.**

The website's own plan catalogue, eligibility rules and Stripe checkout are authoritative for which plans can be trialled, current features, pricing, card requirements, renewal timing and cancellation terms. **Continue with Free** must remain available through the existing signup experience. The app repository also contains a 30-day Club Pro trial CTA and trial-entitlement fields, but this does not replace the website's existing live implementation.

**Division of responsibilities:** ChatGPT/DFINITY ICP plugin may help with free account creation and club/team setup under the user's authorised identity, then display the branded website/app access links. Existing Pro or trial subscriptions can be *read back* from the production membership subscription for the same verified account/club/team. A customer who chooses to subscribe or start a trial does that **independently on the existing website**, not through a plugin-initiated checkout or trial action. The plugin must not claim an upgrade or trial activation until the updated subscription is confirmed through an authoritative read.

**Remaining ChatGPT-only integration verification:** Confirm .com and plugin use the same production principal and club ID; identify the correct subscription query and verify that an already-active paid/trial account's status, expiration and permissions can be read through the existing plugin. Do not perform a live charge or modify Stripe/web onboarding for this PR.

**Delivery status:** No website feature work is required for plan comparison or 30-day trials. This PR documents and integrates with the existing experience; it does **not** change live .com pages or payments.

**Current OpenAI policy constraint:** As of 11 November 2026, published plugins cannot initiate, promote, or link directly to purchases of digital subscriptions (including freemium upgrades), even when the payment is completed on a separate website. The plugin may recognise existing paid access, explain unavailable entitlements and link to a nontransactional **informational** plans page when relevant. Do not add a "Subscribe" button, transactional deep link, paid-plan selection wizard, embedded payment fields or auto-redirection to website checkout through the plugin. See https://developers.openai.com/plugins/plugin-guidelines .

The current Ignite .app ICP web path blocks Stripe/card checkout, whereas native IAP implements receipt attestation and canister redemption but the newest `ignite_v2_` SKUs remain guarded until configured. The separate owner-confirmed .com checkout architecture should be investigated on its own merits: **do not copy these .app limitations onto the .com website without examining the .com implementation**. Store billing rules may limit which payment links are shown inside installed native apps.

**Acceptance gates before claiming ChatGPT recognises paid membership:** confirm the .com and .app use the same effective production II identity and club ID; identify the existing authoritative membership subscription read; use a previously paid test/subscriber account (with permission) to verify the plugin sees its plan and lifecycle changes. Do not duplicate checkout, webhook or membership-sync logic. No live purchase is required or authorised for this PR. Keep all changes on the feature branch until review.


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
