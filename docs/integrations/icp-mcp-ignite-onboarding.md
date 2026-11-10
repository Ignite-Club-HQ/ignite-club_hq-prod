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

### Website signup, payments and subscription reconciliation

The public marketing site is **https://igniteclubhq.com** (distinct from the operational app, https://igniteclubhq.app). The site publicly advertises **Create a free club** and **Compare plans**, but its current destination routes, payment processor configuration and principal-linking behavior have **not** been independently verified. Do not invent a website registration or checkout URL.

**Important current plugin policy (verified 11 November 2026):** OpenAI's published Plugin Guidelines prohibit plugins from initiating, promoting or directly linking to purchases of **digital subscriptions**, including freemium upsells. They permit existing subscribers to sign in, use paid entitlements, and understand why a feature is unavailable; an **informational** plans page may be referenced when appropriate, but not a page that initiates a purchase or checkout. Source: https://developers.openai.com/plugins/plugin-guidelines . Developer terms permit external checkout only subject to applicable policies; the general external-checkout examples are currently approved for eligible physical goods, not Ignite Pro. Do not add a Pro purchase button, price-selection wizard, prefilled payment link, or transactional handoff inside the DFINITY ICP plugin unless the applicable policy explicitly changes or Ignite obtains approval.

**Compliant ChatGPT experience now:**
1. Complete the user's **Free** Internet Identity signup and club/team setup with their permission. Provide the branded app download links and generic public website https://igniteclubhq.com when requested; do not use the website link as an embedded upsell or automatic checkout redirect.
2. If the user independently has a paid subscription, use existing authoritative subscription/entitlement **reads** for that exact authenticated identity and club/team. The user can see paid functionality only after a successful verified status lookup.
3. If a paid-only feature is requested without entitlement, explain the requirement neutrally. A nontransactional informational plan page is allowed under the plugin guidelines, but never link directly to a purchase-starting form. Do not request card details, billing emails, private receipts or payment tokens in the chat.

**Independent website signup/payment architecture — implementation proposal, NOT live:**
- Treat website registration and Stripe/payment session handling as **separate** from ICP onboarding. First verify which website "Create a free club" and "Compare plans" links actually launch; whether the website creates a Supabase account, an Internet Identity account, or another identity; which backend records the subscription; and which server handles verified provider webhooks. Preserve the current email/Supabase payment workflow until this is independently mapped.
- If the website begins to support Internet Identity customers, identify their app account by a **verified, origin-bound Internet Identity principal**, never by a manually entered email, club name, browser localStorage, untrusted return URL or ChatGPT-provided principal string. Require the customer's explicit account-link consent if signing in to a separate web portal.
- The website (not the plugin) may create an idempotent provider checkout session linked server-side to the correct entitled entity (club/team), approved SKU and account, only after confirming the acting user's role. Host payment, subscription terms, receipts, taxes and cancellations on the website/payment provider. Webhook verification and a durable idempotent receipt/journal must precede any ICP entitlement update. Verify renewal, expiration, refunds and chargebacks, too.
- For the existing ICP app, native Apple/Google IAP receipt verification and `identity_access` entitlement redemption already exist, but **web card checkout is explicitly blocked for ICP sessions** in the current app code. Its current `ignite_v2_` catalog also has an unconfigured SKU guard. Do not infer that website Pro payments currently activate ICP Pro access.
- Only after an independently confirmed purchase and authoritative server-to-canister reconciliation may ChatGPT report that Pro is active on re-query. **Never accept a screenshot, a client redirect, a checkout-success query parameter or an unverified receipt as proof of payment.**
- Apple/Google native-app billing rules and local regional exceptions must be reviewed separately before introducing website checkout links inside a native app.

**Implementation gate:** Do not implement or deploy a website-to-ICP Pro activation bridge until the `.com` site's real registration routes, payment ownership, webhook API and relationship to the PROD Internet Identity principal have been verified. Current PR implements only safe public links and informational plugin guidance; it creates no payment sessions and grants no Pro status.

References: https://developers.openai.com/plugins/plugin-guidelines ; https://developers.openai.com/plugins/build/monetization ; https://developer.apple.com/app-store/review/guidelines/ ; https://support.google.com/googleplay/android-developer/answer/9858738 .

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
