# DEV ChatGPT plugin — first-content club admission fast path

**Status:** Source-only candidate for review and disposable PocketIC checks. No canister upgrade, main merge, frontend deployment, PROD, Cloud Engine, email/Supabase or messaging/events changes.

## Baseline through the official DFINITY ICP connector

On a previously connected Test 3 session on the canonical DEV frontend `https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net`:

| Path | First measured run | Immediate repeat |
| --- | ---: | ---: |
| Discover canonical DEV app | 2.251s | 2.076s |
| Resolve existing Internet Identity | 2.209s | 0.804s |
| `identity_access.whoami` | 1.712s | 1.476s |
| `club_domain.read_my_club_memberships_indexed(null, 50)` | **6.839s** | **6.231s** |
| End-to-end of these four sequential calls | **13.013s** | **10.587s** |

These are assistant-to-connector **wall times**, not isolated canister CPU or fresh Internet Identity authentication, and not evidence of p95 latency.

## Audited bottleneck and narrowly scoped change

Previously `club_domain.admitAccount` first awaited `AccountAdmission.eligible(subject)`, which calls the trusted `identity_access.read_principal_eligibility`. Then, when protection was active, it awaited `AccountAdmission.account(subject)`, which calls trusted `identity_access.read_service_account`. Each service method performs its own authority verification and live registry reconciliation.

The existing `read_service_account` is **stronger than eligibility alone**: its subject-owned account response requires an active, nondeleted account, a current permitted identity, and filtered linked principals. It is already restricted to configured canister readers and rechecks admission configuration and independent registry state.

This candidate adds `admitAccountForFirstContent` used by exactly:

- `read_my_club_memberships_indexed` (first club IDs)
- `read_account_my_role_grants` (caller-visible roles)

For those two caller-scoped reads, it first requests the existing `read_service_account` result. If a valid current account returns, it applies the **same** receiver-side unlink fence, aliases snapshot and authority/membership epoch recheck without a redundant eligibility RPC. If no valid account can be returned, it **still calls the original** `eligible(subject)` method, rechecks all local authority/removal/name-cleanup fences and allows only the existing **exact-principal** behaviour on proven eligibility. Rejected or unavailable eligibility denies; it never invents clubs/roles or retries an expired Internet Identity grant. When account admission is disabled, it uses the entire unchanged `admitAccount` path.

All other club endpoints, including writes and child/roster PII, continue to use the original path. No Candid types, backend Identity Rust code, service-reader inventories, canister IDs, controller permissions or persisted account data change.

## Acceptance and non-goals

- Full CI and Motoko enhanced-migration compile.
- Offline source guard for both exact methods, unchanged generic admission and fail-closed fallback.
- Disposable two-group PocketIC: verified linked account, outsider cannot fetch trusted account, caller memberships/roles, suspended/revoked/unlinked subject denied, relevant receiver/Identity canister upgrades. This is local test data only.
- Must **not** claim runtime speed improvement from source-level tests. Rebenchmark 10+ signed connector reads with identical DEV principal/club set **after separately approved exact DEV club canister deployment**, plus negative authorised/unauthorised tests before rollout completion.
- No first-time consent/browser UX timing, MCP protocol change or backend connector transport speedup. PROD remains untouched; merging shared source into main does not approve PROD deployment.

**Release boundary:** The safe deployment candidate is an exact DEV Group 2 `club_domain` upgrade only, after reviewed module/hash/settings evidence and matching preflight. No automatic upgrade or recovery has been authorised. Run before/after signed reads and confirm no regression in linked parents, club admins or revoked identities.
