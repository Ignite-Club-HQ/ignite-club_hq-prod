# Ignite ChatGPT integration — reuse native Internet Identity and cross-group access
**12 November 2026 | DEV only | Read-only discovery | No deployment**

## Decision

Do not deploy the experimental Group 2 account-reader in draft PR #1480 just to launch a plugin. The normal app already uses **one Internet Identity principal**, shared `identity_access.whoami()`, and caller-scoped group membership/role grants (`frontend/src/live/features/myRoleGrants.ts`, `frontend/src/live/groupSessionLive.ts`, `frontend/src/live/crossGroupClubs.ts`). Local copies of an account are not a prerequisite for all native Group 1/Group 2 member reads.

A separate ChatGPT integration should first reuse the same principal and existing authorised canister methods, rather than issue a second Internet Identity, copy credentials, or invent a cross-group account.

## Read-only live DEV evidence, collected using the *distinct Test* ChatGPT connection

- Canonical app URL: `https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io`; connector's effective DEV derivation origin: `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app`. Use the connector-returned origin, never construct one.
- Distinct Test identity principal: `mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe`. `identity_access.whoami()` with Test returns an active account containing that exact principal.
- The Primary and Test full-access *connection labels* both resolved to the same other principal when last checked. Connection labels are not evidence of principal identity. Do not substitute the founder connection for a new customer.
- **Canonical DEV frontend manifest** declares Group 2 `club_domain` `yfwyv-nyaaa-aaaal-qxpyq-cai`. The `https://ignite-club-launchpad.lovable.app` manifest currently does **not** declare that canister, although its bundle mentions the address. The official ICP MCP refuses calling canisters not declared by the chosen app. This is a **publishing/parity issue**, not an Internet Identity limitation.
- Using the Test identity, caller-scoped OQL `clubs` and `teams` on legacy/shared club_domain `mzzzv-taaaa-aaaal-qxlrq-cai` returned authorised rows successfully.
- On canonical DEV frontend, the G2 canister OQL schema is discoverable, but *actual* caller-scoped `clubs` and `teams` queries trap `Use protected consensus account read`. Direct G2 `read_account_my_role_grants()`, `read_my_club_memberships_indexed(null,50)`, and `read_account_whoami()` all rejected with `Account admission denied or unavailable` for Test. These are **real blockers**; do not claim native-pattern end-to-end ChatGPT cross-group access works yet.
- The native app also calls the `my_role_grants()` **Candid query** for role discovery. However this DFINITY ICP connector restricts canisters with an OQL surface to the OQL query path; it refused calling a raw Candid `query` on the same G2 canister. Therefore, its rejected `read_account_my_role_grants()` **update** is not conclusive evidence that native app's `my_role_grants()` query would fail for the same user. A branded Ignite adapter may need to expose the existing caller-scoped Candid queries via a minimal read-only tool instead of relying solely on generic OQL; never bypass the contract's actual principal checks.
- G2 permission errors do not prove a problem with one principal across groups, but they cannot be bypassed by reading unscoped club directories or copying account records. A known existing native user principal with G2 membership should be compared through an approved same-principal test.

## Minimal plugin architecture

1. `open_app` canonical DEV app; capture exact app URL, derivation origin and declared canister set. Connect user explicitly and read `get_app_principal`.
2. Verify `identity_access.whoami()` returns active account containing the *same principal*; do not register or attach accounts during discovery.
3. For each group, use the *native* caller-scoped role/membership methods. Verify the complete set and failed groups, not merely the number of rows. Never interpret a refused group as the user having zero clubs.
4. Route each requested club by the actual router ownership/placement before write; re-check its current role grants on the owning canister. Caller-supplied club IDs, names or unscoped directory entries never grant privileges.
5. For initial read-only plugin, show Group 1 grants and an explicit **G2 unavailable** status, not a false successful empty result. No credentials, new canisters, local account sync, or elevated service reader are needed for that limited functionality.
6. For later writes (club/team onboarding, invitations), require user consent per action, exact placement and role checks, stable idempotency/re-read after ambiguous update, and fulfil existing profile/terms/legal/payment steps in the existing Ignite UX.

## Non-negotiable acceptance before saying multi-group plugin works

- [ ] ChatGPT and native app derive the **same principal string** under the *same canonical DEV origin* for the same consenting Test user.
- [ ] Both entrypoint manifests declare the exact reviewed G2 club canister, or plugin uses only canonical DEV frontend until both are published.
- [ ] Test identity with real G2 club grant can read `read_account_my_role_grants` and `read_my_club_memberships_indexed` without `sync_my_linked_account` or separate service-reader commissioning; verify its actual granted club/team, not fabricated data.
- [ ] An unrelated Test identity cannot read or mutate that G2 membership; removed/suspended users fail closed.
- [ ] Request denied by G2 admission is surfaced as `unavailable`, not an empty club listing or an automatic retry/fallback that changes accounts.
- [ ] No rollout to PROD or real subscription charge; complete the exact DEV first-user flow before production release.

## Where code needs attention next

1. **Frontend manifest parity**. Compare the published Lovable DEV `/.well-known/ic-architecture` with canonical DEV frontend. Publishing Group 2 metadata to Lovable must be done through its actual hosting/deployment pipeline and tested live. The source `frontend/scripts/prepare-canister-dist.mjs` already generates G2 discovery for the canonical frontend; simply editing that script does not update Lovable's served manifest.
2. **Group 2 read admission**. Reproduce with a principal known to have a G2 role and confirm how the native app currently authorises that same caller. Review current Group 2 admission binding, not the broad production account-reader from PR #1480 by default. A protected governor diagnostic may be necessary to distinguish reader-policy mismatch from stale authority config. Specifically distinguish `my_role_grants()` query success in native from `read_account_my_role_grants()` update failure in the MCP connector.
3. **Connector packaging**. DFINITY MCP can access declared canisters now. A branded Ignite plugin still requires an app-specific customer experience, authentication/consent policy, action design and discovery/connection publishing; connecting the generic ICP plugin alone is not proof Ignite has a standalone plugin in the ChatGPT directory.

**Do not merge/deploy PR #1480** for this path without a separate, demonstrated dependency and security review.

## Protected-role-query adapter verification (12 November 2026)

Source-level finding in `backend/club_domain/src/main.mo`:
- `my_role_grants()` calls `denyLegacyAccountQuery()`; when Group 2 account protection is required, this query **traps** `Use protected consensus account read`.
- `read_account_my_role_grants()` is the exact protected update counterpart, but first calls `await admitAccount(caller)` against the configured identity admission authority. On live Group 2 with the distinct Test principal, it returned `Account admission denied or unavailable`.
- The native app already ships `frontend/src/live/accountReadAdapter.mjs` and wraps club actors through `adaptRemoteAccountReads` in `frontend/src/live/domains.ts`. It attempts `my_role_grants()`, recognises that specific protected-read trap and retries the **exact Candid signature** `read_account_my_role_grants()`. It does not switch to a privileged principal or invent a second account.
- Therefore, **merely adding a plugin adapter to invoke the protected counterpart cannot bypass the live Test-account admission denial.** The same Test principal may well also fail in the native app until configured admission is repaired or an alternative reviewed production flow is shown. The owner's statement that one Internet Identity can access both groups is compatible with this: another group's live configuration or a different account/grant may be involved. Do not assume native access for this exact Test user without a same-principal observation.
- Generic ICP MCP currently offers Group 2 OQL, and it can call the protected update method directly. Its OQL and protected update both refuse at Group 2 account admission. These are not simply discovery failures.

New pure, read-only helper `scripts/ignite-plugin-native-preflight.mjs` reuses the **existing production `adaptRemoteAccountReads`** on actors supplied by one trusted delegated identity, verifies exact `identity_access.whoami()` principal membership, and returns distinct `available`, `not_declared`, `admission_unavailable`, and `read_failed` statuses. Permission-bearing role output is deliberately `null` if even one requested group fails. No new endpoint, account-linking service, SDK or live canister mutation is introduced.

Its isolated Node tests verify protected twin fallback, query/unavailable refusal, missing manifest, unexpected network failures, foreign/suspended identities and duplicate group assignments. These mocks test classification and principal preservation **only**, not a real native Android/iOS session; integration remains blocked on the live group admission review.

**Next technical action:** use the same consenting non-admin II principal to compare the *actual native app's* `read_account_my_role_grants()` against the ChatGPT connector and obtain an authorised governor's read-only Group 2 admission settings (no grant/reconfiguration). Do not weaken `admitAccount`, use a governor token for a customer, or deploy PR #1480 merely to force a positive result.
