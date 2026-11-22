# PROD club placement & ChatGPT creation fix — 23 Nov 2026 (DEV source only)

## Root causes
1. PROD Group 1 ("base") is registered CLOSED on purpose: `prod-base-group-policy.mjs` only allows a closed registration; opening needs a separate governor step. Not a bug, but it means the router path cannot place PROD clubs yet.
2. `club_domain.create_club` skipped the router whenever all three `IGNITE_NEW_CLUB_PLACEMENT_*` settings were absent (none are set in DEV or PROD), so direct callers (ChatGPT connector, routing-off app) bypassed placement.
3. ChatGPT guidance said "reserve if placement is active" without concrete steps, retry rules or verification.
4. Capacity evidence: `deploy/groups/tested-limits.json` is DEV (`mainnet`) planning estimates; no PROD limits, no blob/processing enforcement in the router.

## Changes
- `backend/club_domain/src/main.mo`: opt-in `IGNITE_NEW_CLUB_PLACEMENT_REQUIRED="true"` — with the three bindings missing, new clubs are refused (fail closed). Default unchanged so a prod merge cannot stop club creation before Group 1 is opened. Agent guide now spells out the exact router → assigned group → create → country/settings → team → verify workflow and same-UUID retries. No Candid/interface change.
- `backend/shard_router/src/groups.rs`: policy tests (G1 preferred below 80%, 70% prepare, G2 at 80% club or heap, closed/low-cycle/stale/other-target refuse).
- `frontend/src/lib/clubCreationError.ts` + test: placement refusals shown in plain English.

## Tests
shard_router cargo: 58 + 18 passed. club_domain moc check: OK. Vitest (legacy config): groupDispatchNewClub + clubCreationError 9 passed.
Not run: replica test for the REQUIRED switch (needs local replica), real ChatGPT end-to-end on DEV.

## Live PROD
Anonymous `list_groups` on PROD router tgfbl-qiaaa-aaaai-ayena-cai → "Forbidden" (governor-only). Group 1 state, health readings and club_domain settings NOT verified.

## Manual steps (all need Paul's approval, governor identity)
1. Read-only: `list_groups`, `read_group_registry("mainnet")`, `read_group_opening_configuration` on PROD router; record base `accepting`, health age, cycles.
2. Record fresh health (`record_group_health`) and set conservative budgets for base.
3. Open base through the existing general-opening/approval process (not automated here).
4. Upgrade PROD club_domain with `IGNITE_NEW_CLUB_PLACEMENT_ROUTER=tgfbl-qiaaa-aaaai-ayena-cai`, `_GROUP=base`, `_TARGET=mainnet`, `_REQUIRED=true` (only after step 3, else creation stops).
5. Turn on group routing for PROD app so web/mobile call `place_my_new_club`.
6. Publish PROD ICP discovery for the connector (currently DEV-only) and run one DEV end-to-end ChatGPT creation.
7. PROD capacity: PROD tested-limits file (load-tested), collector run against PROD IDs; blob/processing remain planner-only.
