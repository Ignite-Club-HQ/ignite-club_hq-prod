# Signed PROD connection check

This check reads existing infrastructure with the existing encrypted PROD governor key. It does not configure canisters, register/open groups, publish an app, access Supabase or repoint DEV.

## Owner steps

1. Once the changes are synced, run **[REPO] Promote ICP canister code to the live repository** from **main**, mode **plan**. The intended additions are `scripts/prod-connection-check-policy.mjs`, `scripts/prod-connection-check.mjs`, `scripts/prod-connection-check.test.mjs`, and `.github/workflows/check-prod-canister-connections.yml`. Review any differing files before authorizing overwrite.
2. Run the same workflow with mode **apply** after reviewing the plan. No overwrite should be needed for these four new paths. Do not ignore unrelated drift.
3. Run **[PROD] Check PROD canister connections** from **prod** in the live repository. There are no form fields or payment steps. Approve the production environment if GitHub requests it.
4. Share the run summary and download **prod-connection-check**. The JSON lists independently read connection pairs and mismatches; router group inventory/approval evidence needs review, not automatic activation.

## Interpretation and limits

- `READBACK`: readable infrastructure; only the explicitly listed expected links are checked.
- `LINK_MISMATCH`: missing, duplicate or unexpected configured destination. Nothing is repaired.
- `UNREADABLE`: inaccessible/failed reader; no diagnostic secrets are retained. Initial identity inventory may legitimately be unpinned, but that remains a readiness gap.
- `REVIEW_ROUTING_EVIDENCE`: group inventory or `mainnet` routing-approval reply to review. Success is not routing activation or an app-release authorization.
- Existing interfaces implement these configuration/approval readers as consensus **update calls**. Source inspection found infrastructure-only reads; no setter is invoked. Such reads may cost a small amount of cycles and may enter transient guards. They are not a query-only audit or an atomic whole-inventory snapshot.
- Several settings are not exposed by these readers, including some gallery/Vault links and immutable encryption initialization. This report cannot prove them.
- All calls use the exact recorded PROD base inventory and expected governor, not runtime frontend defaults. Unexpected/missing IDs or a non-prod branch stop before canister calls.
- Credentials remain in the temporary runner directory, cleaned on exit, outside the artifact. The workflow uses read-only repository access and has no schedule.

This preview remains connected to DEV; no merge, database change, push activation, funding or app publication is part of these instructions.