# Ignite ChatGPT onboarding — DEV acceptance and identity continuity

Status: **pre-deployment runbook**. The feature branch is not a deployed environment. Use this before an approved DEV rollout of PR #1456; nothing here authorises a live write.

## Confirmed from current production observations (11 Nov 2026)

- DFINITY ICP MCP `open_app("https://igniteclubhq.app")` resolves the **declared** Internet Identity derivation origin `https://igniteclubhq.app`; its current membership connection is not query-only.
- The published production app advertises both `https://igniteclubhq.com` and `https://www.igniteclubhq.com` in its II alternative-origins list. This establishes that the production app **allows** those website origins to request a shared identity. It does **not** prove that an individual marketing-site login has actually requested that derivation origin.
- The live PROD `club_domain` OQL schema currently lists `clubs` and `teams` only. The proposed `club_subscriptions` and `team_subscriptions` views in PR #1456 are **not yet deployed**. No paid subscription read was performed to conclude that another account has Pro.
- Current source: `frontend/scripts/prepare-canister-dist.mjs` publishes PROD's canonical `/.well-known/ii-derivation-origin` as `https://igniteclubhq.app`, while DEV uses the DEV frontend canister origin. The build policy is now enforced by `frontend/scripts/iiOriginPolicy.mjs` and its tests.

## Build / release checks

1. Verify that PR #1456 CI passes source checks, Motoko enhanced migration validation and the disposable PocketIC signup, invite and subscription privacy rehearsal.
2. Verify the generated DEV `dist-canister/.well-known/ii-alternative-origins` omits the production `.com` site and `igniteclubhq.app`, and contains only DEV frontend aliases and approved DEV previews.
3. Verify DEV `ii-derivation-origin` is its **own** frontend canister's `https://<canister-id>.icp0.io`, never the production app.
4. DEV deployment must go through the repository's established **[TEST]** controlled deployment process and owner review. Do not merge to `prod`, change canister controllers/keys or activate group placement as a side effect of onboarding.
5. After deployment, query DEV's published `getApiDoc()` and caller-scoped `schema()` through the official ICP plugin, and confirm `club_subscriptions` / `team_subscriptions` are actually present. A passing compile is not proof of a published API.

## First-time customer DEV rehearsal

Use two freshly created, **non-admin** Internet Identities and disposable test club/team identifiers. Authenticate through the actual ChatGPT ICP connector; never use the founder or governor's delegated identity.

- [ ] Open **only** the intended DEV URL in ChatGPT, confirm the declared derivation origin and allowlisted DEV canister IDs.
- [ ] Test `identity_access.whoami()` before signup, then register only with customer approval.
- [ ] Complete the trusted app's secure display-name workflow and accept the **current** legal terms using explicit consent. Verify both, never infer success from registration alone.
- [ ] Before creating a club, inspect authorised existing clubs; verify routing placement and new-club policy. Create exactly one club with the customer's permission. Verify the creator receives admin rights.
- [ ] Record home country, full club settings and required default conversations. Do not claim full setup if these steps aren't completed.
- [ ] Create one team within the verified club and limits; verify with a caller-scoped OQL read.
- [ ] Create a parent invitation, use the **second** identity to accept it, and verify it sees only the intended club/team.
- [ ] Check the second identity cannot edit team details or mint unauthorised links; check an unrelated third identity cannot view subscription OQL.
- [ ] Inject uncertain-response failures; read back by stable IDs before any retry.
- [ ] Validate synthetic Pro/trial records in disposable PocketIC, not by charging a real card. After approved DEV deployment, an authorised test account can read subscription states; absent rows are not proof a Stripe transaction failed.
- [ ] Verify both branded store routes point to the intended store page once their Netlify routes are actually deployed. Never display a Lovable-based link.

## Cross-site PROD principal match — separate read-only acceptance

The website's existing Internet Identity/Stripe experience is already in production, but **the II principal matching has not been independently demonstrated** from both sides.

1. The same consenting test user signs into `https://igniteclubhq.com` using the current website flow, and into `https://igniteclubhq.app` using the app flow, **without** creating a second club or starting a paid trial.
2. Have each trusted authenticated application surface report the **effective principal** for that logged-in session (prefer `identity_access.whoami`/existing authenticated diagnostic). If the website doesn't currently expose a safe diagnostic, this remains *unverified* rather than guessing from the browser origin, display name or email.
3. Under that user's consent, compare the two actual principal strings **privately**. They must be identical and each have the same club membership/roles under the app's authorised reads.
4. Confirm ChatGPT's `get_app_principal` against the declared production origin returns the same principal as that **test account**; the assistant's existing account cannot stand in for them.
5. After a separately authorised, already-existing paid/test subscription, read its membership entitlement through deployed OQL. Check `premium_active`, `trial_active`, expiry and club scope against the website's state; don't create a Stripe transaction from ChatGPT.
6. If the principals differ, stop and investigate the website's actual II `derivationOrigin` and `/.well-known/ii-alternative-origins` setup. Do **not** merge principal identities or migrate clubs based on a display-name/email match.

Never publish a principal, token, recovery phrase, payment receipt or minor's identity in public CI logs or PR discussion. Preserve consent evidence privately.

## Release decision

Keep PR #1456 in draft until the DEV canister has been upgraded via the authorised process, live queries and a fresh-user journey pass, and cross-site identity continuity is demonstrated. This runbook is **not** permission to deploy, merge, create paid subscriptions or test in production with real customers.
