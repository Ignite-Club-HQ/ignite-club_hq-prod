# Signed PROD connection check

This check reads existing infrastructure with the existing encrypted PROD governor key. It does not configure canisters, register/open groups, publish an app, access Supabase or repoint DEV.

## Owner steps

1. Once the changes are synced, run **[REPO] Promote ICP canister code to the live repository** from **main**, mode **plan**. The intended additions are `scripts/prod-connection-check-policy.mjs`, `scripts/prod-connection-check.mjs`, `scripts/prod-connection-check.test.mjs`, and `.github/workflows/check-prod-canister-connections.yml`. Review any differing files before authorizing overwrite.
2. Run the same workflow with mode **apply** after reviewing the plan. No overwrite should be needed for these four new paths. Do not ignore unrelated drift.
3. Run **[PROD] Check PROD canister connections** from **prod** in the live repository. There are no form fields or payment steps. Approve the production environment if GitHub requests it.
4. The result table is printed at the end of the **Restore existing PROD key and read infrastructure only** step log and on the run Summary. Share either, and optionally download **prod-connection-check**. The JSON lists independently read connection pairs and mismatches; router group inventory/approval evidence needs review, not automatic activation.

## Interpretation and limits

### Group readiness correction (1 November 2026)

The earlier “All readable connections confirmed” result was not completion of PROD setup. The check now prints base connection health separately from missing group prerequisites and reads a bounded consensus registry page (up to 64 groups, the deployed router's actual page maximum). An incomplete/truncated registry, unpinned identity, missing independent g2 or missing/stale configuration-bound approval fails overall readiness. The artifact also contains a **non-executable** setup proposal. It cannot authorize payment, settings, registration, lifecycle release, opening or publication.

Four zero-link comparisons (insights, media metadata, timer and router) mean only that this checker defines no expected service-link keys there. They are not exemptions from service configuration or group readiness. Identity access's missing trusted registry is a setup gap, not a successful configuration.

The existing TEST group tools hardcode DEV governor/mappings and cannot be run against PROD. Completing identity pinning through the supported production API requires the independently reviewed bound-deletion release; do not set rehearsal flags or invent a bypass. The existing 18 PROD services can be retained as the base group. A new independent g2 needs its own 13 services, verified IDs/modules/subnets, dedicated media derivation and current funding review. No creation is authorized by this read-only run.

Additional groups discovered in the router are reported but remain unreviewed until matched against independent PROD provisioning evidence. Passing bounded infrastructure checks never establishes full module/settings/removal-wiring acceptance or grants opening.

- `READBACK`: readable infrastructure; only the explicitly listed expected links are checked.
- `LINK_MISMATCH`: missing, duplicate or unexpected configured destination. Nothing is repaired.
- `UNREADABLE`: inaccessible/failed reader; no diagnostic secrets are retained. Initial identity inventory may legitimately be unpinned, but that remains a readiness gap.
- `REVIEW_ROUTING_EVIDENCE`: group inventory or `mainnet` routing-approval reply to review. The target alias remains `mainnet` for public-network routing compatibility; deployment binding must be independently `prod`. Success is not routing activation or an app-release authorization.
- Existing interfaces implement these configuration/approval readers as consensus **update calls**. Source inspection found infrastructure-only reads; no setter is invoked. Such reads may cost a small amount of cycles and may enter transient guards. They are not a query-only audit or an atomic whole-inventory snapshot.
- Several settings are not exposed by these readers, including some gallery/Vault links and immutable encryption initialization. This report cannot prove them.
- All calls use the exact recorded PROD base inventory and expected governor, not runtime frontend defaults. Unexpected/missing IDs or a non-prod branch stop before canister calls.
- Calls use the pinned `@icp-sdk/core` agent against `https://icp-api.io` with the decrypted governor key; replies are certified and decoded with typed interfaces, so no command-line output is parsed.
- Credentials remain in the temporary runner directory, cleaned on exit, outside the artifact. The workflow uses read-only repository access and has no schedule.

This preview remains connected to DEV; no merge, database change, push activation, funding or app publication is part of these instructions.