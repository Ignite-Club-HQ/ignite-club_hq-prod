# PROD canister connections and DEV separation — read-only audit

Checked at 2026-10-31 23:47–23:49 UTC. No canister updates, database access, deployment, app configuration changes or push activation performed.

## Evidence

- Public PROD head: `33a0fcb1225a0b65b66a0345afc8bca4878fdf12`.
- Successful provision source: `1be11532ce57364563f1dbcbeaa967154075ca45`.
- GitHub run `41252895887`: backend, create/wire, release recording and ID persistence succeeded; frontend skipped.
- Anonymous queries used only methods declared `query` in deployed Candid. All 18 deployed interfaces were retrieved through certified read-state metadata.
- Certified module hashes and controllers were read without management settings calls. All 18 services have exactly the expected PROD governor controller: `kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae`. This proves controllers, not every internal governor setting or source/module equivalence.

## Observed live state

| Check | Result |
| --- | --- |
| All 18 PROD health queries | Cycles and memory readable; installed module hash present for each |
| Remaining fuel | 0.475–0.498T per service; 8.840T total at sampling time |
| Memory | 5.3–43.4 MB per service |
| Club → PII link | `pii_canister_status()` returns PROD PII `tihmd-lyaaa-aaaai-ayema-cai`, as expected |
| Club media capability | `club_media_lock_version()` returns `1`; capability, not decryption acceptance |
| Router revision/routes | Revision `0`; bounded `list_routes(null, 1)` returns no routes and no next page |
| Placement registry | Revision `0`; ICP and Supabase available; bounded placements page empty |
| Routing fallback | `club_domain.get_app_config("backend_routing_config")` absent |
| Timer | `armed=false`, no next run; idle state alone is not a fault |
| Anonymous group enumeration | `list_groups()` returns `Forbidden`, correctly governor-gated |

Current fuel is below the existing health tool's 1T warning threshold. This is a warning, not evidence of a frozen canister and not authorization to spend or top up. Earlier funding/provisioning estimates must not be treated as current balances.

## Connection verification boundary

The successful provision script contains reciprocal wiring for club/events/competition/chat/notifications/Vault/media/PII/rewards. Its run succeeded, but most current link values have no public query getter. Therefore those links have **deployment execution evidence, not independent live readback**.

`read_group_opening_configuration`, `read_group_registry_page`, `read_public_group_targets`, and `read_routing_approval` are Candid **update** methods despite their read-only intent. None was invoked. Signed governor readback through an explicitly reviewed protected workflow is the next step for full connection/registry/approval verification.

The provision script does not register router groups, placements or routing approvals. Combined with router revision zero, there is no evidence here of an activated production group-routing setup. The empty route table does not alone establish whether direct base-canister app access could work.

## DEV / PROD separation

- Recorded DEV and PROD inventories contain 18 unique IDs each and have **zero overlap**.
- The running preview's served generated-ID module contains all 18 DEV IDs and zero PROD IDs. Neither it nor this project's configuration was repointed. This checks served defaults, not authenticated club-specific runtime routing.
- Official Netlify, ICP production and native release wrappers select PROD inventory; missing PROD mappings do not automatically substitute DEV inventory.
- Current live repository lacks `frontend/package.json` and `deploy/frontend-prod/icp.yaml`; backend provisioning consequently skipped frontend publication. It did not update the production app's sign-in or connect that app to PROD services.
- Source checks expose an isolation gap: runtime administrator overrides and full target-registry JSON accept syntactically valid IDs without enforcing DEV/PROD membership. Generic live builds can also use committed DEV defaults if the guarded production wrapper is bypassed. Preview selection is not unconditionally pinned to DEV.
- Hence official wrapper intent is correct, but **end-to-end isolation is not yet a guaranteed invariant**. No claim is made that an actual PROD override currently contains DEV IDs; that setting was not read.

## Next steps — canister scope only

1. Review a protected PROD-governor connection/registry/approval readback workflow; use existing encrypted key, print only allowlisted infrastructure values and leave configuration untouched. Signing credentials are available only in the owner's GitHub environment, not this audit session.
2. If readback confirms initial/unregistered routing, separately approve exact PROD group registration and approval. Do not run DEV Group 2 opening tools against PROD or repoint this preview.
3. Before connecting/releasing the production app, enforce DEV/PROD isolation on its final effective IDs, including runtime overrides and alternate target JSON; keep preview pinned to DEV and require complete PROD inventory for production.
4. Review fuel independently; no funding, provisioning rerun, database upgrade, merge, publication or push activation is implied by this report.

## Validation

29 existing environment, hosting and exact-commit publication tests passed. Preview diagnostics report build OK. These tests do not cover the runtime override isolation gaps above. Authenticated app routing, full governor-only live connection readback, routing approval and installed photo-key preservation remain unverified.