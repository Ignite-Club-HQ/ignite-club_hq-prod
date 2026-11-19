# DEV first-content admission — exact two-canister read-only preflight

**Status:** draft, check-only. The source changes in PRs #1615 and #1616 were merged; no backend Identity or Group 2 Club Domain upgrade is approved by this document. The `IGNITE_FIRST_CONTENT_COMBINED_ADMISSION` flag defaults to off.

## Exact targets verified against the canonical DEV app manifest

- **Shared DEV Identity:** `mq2sj-fiaaa-aaaal-qxlqa-cai` (`identity_access`).
- **DEV Group 2 Club Domain:** `yfwyv-nyaaa-aaaal-qxpyq-cai` (`club_domain`).
- Canonical DEV frontend: `https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net`, derivation origin `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app`.
- **Out of scope:** Group 1 Club Domain `mzzzv-taaaa-aaaal-qxlrq-cai`, Group 1/2 PII, chat/events, workers, PROD, Cloud Engines, Supabase/email, all account/child/PII records, roles and configuration writes.

The prior connector sample measured **6.839s** initial and **6.231s** repeat for the Group 2 indexed memberships call. These are assistant-to-connector wall times, not canister execution times or improvement evidence.

## Preflight operator route (only after separately reviewing and merging this check-only PR)

1. Open GitHub Actions **[TEST] Upgrade backend (all test groups)** on `main`.
2. Set **Action = check** and **Scope = dev_first_content_admission_preflight**. Leave **Checked plan** and **Confirmation** empty. Never use `upgrade` or `recover` with this scope: policy rejects either before governor restoration.
3. The existing workflow compiles candidate `identity_access` and `club_domain` WASMs from the exact workflow revision, verifies the pinned mainnet/group inventory and subnet, original registrar/club wiring, current controller (sole pinned DEV governor), running state, minimum cycles, installed module hashes, settings/environment consistency and original encryption key continuity. It reads status, *not* user data. The workflow's `check` path exits before any install/journal publication.
4. Download the **all-group-upgrade-report** artifact and inspect `check.json`, `g2-club_domain-wiring.json`, candidate new hashes and existing module/settings hashes. Compare output to the exact source revision; do not copy a hash from a previous run.
5. **Fail closed** on any changed controller/subnet, insufficient cycles, unknown Group 2 Club identity, extra active group, mismatched Candid/ABI, unapproved runtime settings, in-flight removal/recovery, inconsistent registration, missing key continuity or missing/unreadable evidence. No automatic top-up, settings correction or retry-as-upgrade.

The existing general `club_migration` scope is **not** acceptable for this change: it includes Group 1 and Group 2. The `dev_identity_directory` scope covers Identity alone and does not establish a Group 2 club release plan.

## Subsequent DEV release gate — separate approval required

- Review exact installed and candidate hashes and a stable-memory upgrade/rollback plan for both modules. The first upgrade would be the shared Identity method `read_member_admission` with existing reader grants unchanged. Validate old Club Domain reads continue with its current method.
- Only after Identity's method and security checks are confirmed, separately approve the exact Group 2 Club Domain upgrade **without** enabling the combined-read flag. Revalidate existing memberships, linked principals, revocations, admin/parent access and PII/name services.
- In a further guarded, separately approved Group 2 configuration-only upgrade/release, explicitly enable `IGNITE_FIRST_CONTENT_COMBINED_ADMISSION=1` and verify there is no fallback-to-two-RPC regression or denied-principal/alias leakage. Never enable for Group 1, PROD or Cloud Engines by inference.
- Benchmark **at least 10** signed repeated original-connector Group 2 membership and role reads against the same user/club set, compare before/after wall times and error rates; preserve access-denial negative tests. If no measurable improvement or any authorization regression, disable the flag under a separately reviewed recovery procedure.

The new check-only scope has deliberately **no upgrade or recovery mode**. Any future live deployment needs an additional scope/PR with its own exact two-canister plan, rollback and authorization. This doc does not authorize one.
