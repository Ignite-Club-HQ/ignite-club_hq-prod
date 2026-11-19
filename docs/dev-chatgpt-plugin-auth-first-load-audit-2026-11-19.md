# DEV ChatGPT official ICP connector — authentication and first-load audit

**Scope:** Priority 3 only: DFINITY's official ICP MCP, existing Test 3 signed delegation, canonical DEV app `https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net` and derivation origin `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app`. No messaging or events performance work, PROD, Cloud Engines, DB changes, permissions, backend install, or client-side plugin bridge.

## Read-only observations (19 Nov 2026)

Measured with ChatGPT-connected ICP tool calls by the assistant; each wall time **includes MCP/LLM host transport, network and canister processing**. Calls were made with an **already-connected** Test 3 Internet Identity. These are small, uncontrolled samples, not a fresh Internet Identity consent/login experience, verified canister execution durations, or p95 measurements.

| Operation | Observed wall time | Method / evidence |
| --- | ---: | --- |
| Discover canonical DEV manifest | 5,389 ms | Official connector `open_app`; 27 reviewed declared services, no discovery error |
| Resolve selected existing signed identity | 4,330 ms | `get_app_principal`; same pinned DEV derivation origin |
| Read account status | 1,594 ms | `identity_access.whoami()` query with source-reviewed minimal Candid; active account |
| Read profile | 1,563 ms | `identity_access.get_profile()` query with explicit reviewed Candid |
| Read terms acceptance | 1,832 ms | `identity_access.my_terms_acceptance()` query with explicit reviewed Candid |
| List existing G2 role grants | 5,691 ms | `club_domain.read_account_my_role_grants()` authenticated update-method read |
| List existing G2 memberships | 5,703 ms | `club_domain.read_my_club_memberships_indexed(null, 50:nat16)` caller-scoped read |
| Four independent post-identification reads scheduled together | 13,320 ms total | Profile, terms, indexed memberships and roles all succeeded; no demonstrated parallel speed gain |

**Observed discovery issue:** `get_canister_candid` for shared Rust `identity_access` returned a missing certified `candid:service` metadata path, even though the canister's declared and caller-authorised `whoami` query worked successfully when an exact minimal Candid was explicitly supplied from `backend/identity_access/identity_access.did`. Do not treat an absent interface metadata lookup as no account. Supplying typed method declarations is a connector feature, not a new trust authority. Changing canister metadata would require a separate security/release review and is **not** part of this PR.

## What is and is not the problem

- Manifest discovery and principal lookup alone took ~9.7 s as separate observed operations, before reading any signed member data. This is end-to-end connector cost, and its internal network, OAuth and cache contributions are **not** isolated.
- Identity queries are relatively short (~1.6–1.8 s each). Serialising profile, terms, all-group routing and every domain's API doc before showing an existing member's club tiles adds unnecessary work.
- Signed G2 membership and role reads each took ~5.7 s. Their server-side identity admission must remain active; do not implement a persistent rights cache or skip canister permission checks.
- The authenticated member's signed-in status can be shown as soon as `whoami` succeeds, while group club lists can be loaded as a second step. The G2 inventory alone is not proof of the complete multi-group membership list.
- **Not established:** total time to interactive first content, first-time login consent latency, connector server overhead, warm/cold p95, same-account improvement due to concurrent work, or any reduction in on-chain cycles.

## Prepared client-facing startup guidance

1. Use **one canonical app origin** and correct real Internet Identity connection. Check `open_app`/derivation origin before calls; never use Lovable preview as automatic PII fallback or PROD as a substitute.
2. Read `identity_access.whoami` with the reviewed minimal Candid if the identity canister's certified interface metadata is absent; show the verified account immediately. Do not assume session validity from a remembered principal.
3. Fetch the minimum caller-scoped memberships and roles needed for the user's first requested view. Defer theme/avatar, terms (except during onboarding or an authorised write), Events, Messaging, encrypted names and unrelated Candid docs.
4. Preserve validated Group 1 / Group 2 placement, current account admission, live club/team membership checks and pagination; fail on `Err`, expired identity, unknown routing or unresolved pages rather than returning an invented complete list.
5. Benchmark from an actual newly authenticated session and from a warm same-identity session separately before claiming performance improvement.

## Change and deployment status

This PR only updates the **private, source-only Ignite-branded pilot skill/README and offline package tests**. It does **not** alter the installed original DFINITY ICP plugin, its runtime or infrastructure. An uninstalled source-only skill cannot deliver an observed live speedup. Further runtime optimisation of manifest, principal or tool-call overhead would require investigation with DFINITY connector maintainers or a separately approved first-party runtime change. No backend upgrade or additional authority has been authorised.
