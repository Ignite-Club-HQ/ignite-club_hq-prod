# Compatibility assessment

## Existing architecture retained

Shared: `frontend`, `identity_access`, `placement_registry`, `shard_router`, `migration_coordinator`, `secret_workload_identity`.

Each of `g1` and `g2`: `club_domain`, `club_points_domain`, `competition_domain`, `events_domain`, `insights_domain`, `media_blob_store`, `media_metadata`, `messaging_domain`, `mini_league_domain`, `notification_queue`, `pii_access_control`, `timer_jobs`, `vault_domain`.

The router's **thirteen domain entries differ from the thirteen built group services**: `media_blob_store` is the group's separate `photo_store`, while `secret_workload_identity` points to the shared canister. The manifest follows this existing contract; it does not invent an extra workload-identity canister in each group.

## Names and photos

Existing vetKeys IBE and the frontend SDK remain authoritative. `PROXY_CANISTER_ID` is the chain-key proxy, **not** the deployment operator. Fresh staged PII source pins the proxy route; ordinary mainnet source retains direct derivation and its existing key/authority. `VETKD_KEY_NAME=key_1` must be present **before first installation**.

`EngineVetKd` already encodes the ordinary management requests and decodes the actual proxy's `Ok {result}` / `Err {InsufficientCycles, CallFailed, UnauthorizedUser}` contract. The outer call is bounded to 30 seconds, carries no attached cycles and does not blindly retry unknown paid outcomes. The derive request's `30_000_000_000` cycles is a field inside the proxy payload, not cycles sent from an engine canister.

The console proxy prefixes the actual PII calling canister's principal, length-tagged, onto the **original** `ignite-pii-v1` context. Do not prefix it again in Ignite. Four distinct PII callers (DEV G1/G2 and PROD G1/G2) yield distinct derivations even using one shared console proxy. Offline SDK checks verify four distinct public-key derivations under that published algorithm and failure with an unrelated decryption key. **They do not verify the live proxy's internal implementation or a live engine round trip.**

Club-wide photo encryption, club/team/role-scoped shared name identities, live audience authorization, fresh denied reads and separate vault restrictions remain unchanged. Engine profile saves now refuse the legacy plaintext fallback if secure saving is unreleased or key/readback fails. Existing non-engine profile compatibility remains unchanged. No plaintext upload fallback is introduced; raw media HTTP URLs still serve ciphertext only.

## Engine calls and resources

- All provisioned service-to-service calls are intended to stay on the same supplied subnet. Preserve same-engine calls; do not mass-rewrite them or weaken their authorization.
- External chain-key calls use the existing cycle-free bounded proxy path.
- HTTPS outcalls remain direct, with their own response transformation; never route HTTP through the chain-key proxy. Existing `IGNITE_CLOUD_ENGINE=1` branches in club/notification code avoid hardcoded mainnet HTTP payments.
- Engine canisters have zero cycles by design. Mainnet top-up/install/deploy scripts are unsuitable and remain untouched.
- **Resolved:** `shard_router` has an explicit resource policy. With its own setting `IGNITE_CLOUD_ENGINE=1` the router requires `min_cycles = 0` (a nonzero engine floor is rejected) and ignores the real zero balance; capacity, heap budget, accepting flag and fresh successful health reads still gate admission. Without the setting (mainnet) a zero floor is still rejected exactly as before. No balance is fabricated.
- DEV memory limits and later PROD compute reservations need measured/reviewed values, not values inferred from mainnet capacity or the console's headline limits. The config validator retains the router's existing max-club and heap bounds.

## Frontend isolation prepared

Only an explicit `IGNITE_LIVE_OPENCLOUD_ENV` selects the standalone artifact path. It requires all 32 named IDs, a matching eighteen-service shared/G1 base, an explicit engine host and that frontend's `.icp.net` Internet Identity derivation origin. It ignores cached mainnet routing/admin overrides and does not fall back to a stored policy on malformed configuration. Normal mainnet builds preserve their existing defaults/precedence.

The isolated Vite path removes generated mainnet canister defaults and the mainnet routing approval snapshot; asset metadata declares the engine groups and uses engine-only callback origins. It does **not** switch on `CLOUD_ENGINE_RELEASED`, fabricate a fresh routing snapshot or alter the live country's routing. The known-mainnet-ID artifact scan remains a hard stop.

**Resolved in code:** engine builds replace every existing-deployment ID literal with a non-principal sentinel, so the legacy DEV name routes, push-queue pins and old frontend origin are inert and the artifact scan passes. On identity_access, the signed account-protection scope and ordinary member access accept an engine binding (`network_kind = cloud_engine`, target = deployment = `opencloud-dev|opencloud-prod`, non-mainnet HTTPS host) only when the canister itself runs with `IGNITE_CLOUD_ENGINE=1`; mainnet keeps its exact PROD pin and an engine never accepts a mainnet binding. Engine private-name reads admit a PII service only if it is in the governor-commissioned ordinary member reader inventory, registered in the same router group as the audience authority, and still commissioned after the last await. Mainnet name pins and allowlists are unchanged.

## Transport and initialization blockers

1. Exported app inventories need independent exact 32-part readback: controller lists, subnet, empty module hashes and app membership. The creator principal is still unresolved. A `getApps` result alone is not effective control proof.
2. **Resolved for fresh DEV:** a distinct immutable-build-pinned, one-use first-install path validates the complete inventory, admission-only receiver modes and management install/lifecycle history without witness/signature. It retains a separate receipt and repeats scoped lifecycle checks on ordinary authorization; global erasure/recovery stay unavailable. Mainnet/OpenCloud PROD continue using their existing signed recovery requirements. No witness action is packaged. Actual engine history semantics and all live acceptance still require verification.
3. Engine-operator `proxy` supports management installs/settings, **not arbitrary new-canister methods**. Reciprocal group setup needs an independently authorized direct internal-governor transport. Installing constructors alone is insufficient.
4. Static frontend Wasm installation is not frontend asset upload. The stock ICP ChatGPT connector cannot upload asset-canister files through the operator's limited relay. A supported asset-upload transport is required; no Git/CI automation or oversized bundle workaround has been added.
5. Real signed-in DEV acceptance and a real encrypted round trip are still outstanding. PROD remains template-only regardless of those outcomes.

## Future capacity and PROD

The reusable group recipe can describe `g3` with thirteen fresh group services and the same six shared services (45 parts); it never creates them. The user's present inventory stays exactly 32. Groups remain closed until capacity/authorization acceptance, and existing assignments never move automatically.

Keep PROD canisters and their original proxy/key derivation on this engine when DEV is later separated. A fresh DEV installation on another engine is safer than moving PROD ciphertext or changing its PII/proxy identity. This package authorizes neither that future move nor PROD activation.