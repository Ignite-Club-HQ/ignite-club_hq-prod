# DEV first-content combined member admission — draft review

This is a stacked, **review-only** proposal on top of draft PR #1615. PR #1614 is independent. No source merge, DEV/PROD/Cloud Engine canister upgrade, account record changes, permission grants, messaging, events, or frontend deployment is authorized by this branch.

## Why

The official DFINITY connector's first Group 2 indexed membership read previously took **6.839 s**, then **6.231 s** on immediate repeat (assistant-to-connector wall clock). The original Club Domain path asks Identity for `read_principal_eligibility` and then `read_service_account` sequentially. Parent PR #1615 tries the stronger account read first, but still needs another round trip when linked-account information is unavailable.

This proposal adds one subject-scoped **`read_member_admission(subject)`** consensus update to Identity. It returns current eligibility evidence plus an optional filtered account. Both are constructed *after* the existing member reader / production-authorized reader inventory and witness verification, without an intervening await. Rehearsal eligibility-only readers can receive eligibility but **never account aliases** without an independent service authority grant.

## Club and compatibility boundary

- Only `read_my_club_memberships_indexed` and `read_account_my_role_grants` try this combined proof, with original anonymous, current authority, membership epoch, name-cleanup and removal gates.
- Accept only positively eligible, exact-subject, non-denied account-version evidence. A supplied account must be active, own the exact sign-in principal, and have the same account version as eligibility; receiver-side unlink tombstones discard old aliases.
- Eligibility with no account is **exact-principal only**; no inference of club membership or role. All actual club grants are rechecked locally.
- If the new Identity method is missing or unavailable during a staggered upgrade, fall back to PR #1615's account-first route and original fresh-eligibility fallback. A *returned denial* is final and cannot fall through.
- The combined call is **disabled by default**, including in DEV. Only an explicitly configured `IGNITE_FIRST_CONTENT_COMBINED_ADMISSION=1` club-domain instance invokes it; a standalone club upgrade must not add a slow missing-method RPC. Disposable PocketIC tests turn it on explicitly.
- Existing generic `admitAccount` and all write, chat, event, parent/child/PII, other-read paths stay unchanged.
- The new method does not create accounts, grant roles, change Candid of existing methods, modify canister readers, controller rights, routing, encrypt names, or change stored data.

## Evidence and release hold

Source contract + Motoko compile + disposable two-group PocketIC tests cover current authorized proof, outsider denial, linked identities, mid-flight removal, identity and club upgrade, and denial/relink fences. The existing admission/legacy tests must stay green. The source code has not yet demonstrated a real latency improvement.

**Do not merge or deploy this candidate automatically.** Merge #1615 first only with separate approval, retarget/recheck this stacked PR, and require independently reviewed exact Identity + DEV Group 2 Club Domain rollout order, upgrade compatibility, canister IDs, hashes, safety preflight and rollback plan. Later benchmark signed same-account reads; PROD, Cloud Engine, Supabase/email and other canisters are explicitly excluded. 