# Exact supported deployment sequence for ChatGPT

**Use the complete fresh-v3 handover and `commissioning.md`.** No witness install/signature is required; the existing empty witness stays untouched. Receiver admission modes, DEV identity pins and shared-name encryption requirements are immutable in the supplied fresh modules. Global erasure/recovery are unavailable, and initial commissioning cannot rearm restore/upgrade state. Complete group placements are emitted as `groups[].registerGroupPlacementCall` with explicitly reviewed/live revisions, never guessed zeros.

**Scope: the existing 32 provisioned DEV IDs in `dev.json` only. No new canisters, PROD installation, reinstall, CI, controller replacement, live routing/DNS changes, Supabase operations or data migration.**

The handover's `manifest.json` contains every DEV target ID, constructor, settings, module/Candid hashes and 80 post-install calls. It remains `executable:false`: a reviewed specification, not a deployment runner. Run `python3 verify-package.py .` after extracting the handover; it performs no network operations. Read `initialization.md`, `commissioning-request-template.json` and `frontend-upload/README.md` together with this checklist.

## 1. Read-only identity and inventory confirmation

Use the OpenCloud/ICP connector's supported operations to open the engine operator, read its current API/Candid and app records, and establish the caller's engine-origin principal. Compare `ignite_dev_v2` with all 32 exported mappings; independently read each canister's subnet, current module hash and effective controllers.

Stop if any target is absent, duplicated, belongs to PROD/another app/subnet, already contains code unexpectedly, or lacks the expected existing operator/owner access. **Do not repair by creating a replacement, changing controllers or reinstalling.** Report the difference to Paul.

Verify the configured DEV governor `tuhlj-zg657-opcmu-4fct6-uxbzv-4j725-r6k7s-yxj4h-4el4q-og5ow-jqe` and existing DEV frontend publisher `jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe`. These are signing roles, not the operator/proxy IDs. No new key is needed. Keep DEV/PROD identities separate; never paste or package private keys/delegations. If either existing signer cannot be used through authorized transport, report that limitation rather than minting a replacement.

## 2. Chain-key proxy verification

Read `get_allowed_subnet` on `ynolw-eyaaa-aaaaj-qspkq-cai`; it must return the supplied engine subnet. Read its public Candid and funding metadata; they must match the reviewed API and engine binding. This was observed read-only during preparation, but recheck before installation.

The deployment operator is `s53an-5aaaa-aaac5-aaaaa-cai`. It must not replace `PROXY_CANISTER_ID`. Public proxy readback does not authorize paid derivations or prove encryption acceptance.

## 3. Review the supplied rebuilt artifact bytes

All eighteen backend implementations are rebuilt and reused across 31 exact backend IDs; the nineteenth artifact is the pinned official certified-assets v0.4.0 frontend module. The isolated frontend asset tree, matched plugin, Candid contracts and complete SHA-256 inventory are supplied. Verify both compressed-file and uncompressed-module hashes in the manifest. Do not rebuild or invoke ordinary mainnet/production workflows merely to install this exact reviewed package.

Initial settings are explicit: 4 GiB per-canister Wasm limit, 3 GiB group heap budget, 100 clubs per group, genuine zero cycles/minimum cycles=0, both groups closed. Engine support/measurement, controller/caller verification and real encryption remain external acceptance requirements, not missing recovery credentials.

## 4. Settings BEFORE first installation

For each DEV backend, merge these reviewed values into its exact existing settings before installing code:

```text
IGNITE_CLOUD_ENGINE=1
GOVERNOR_PRINCIPAL=<verified internal DEV governor>
```

For **both** DEV PII canisters, also:

```text
VETKD_KEY_NAME=key_1
PROXY_CANISTER_ID=ynolw-eyaaa-aaaaj-qspkq-cai
IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE=1
IGNITE_PRIVATE_PROFILE_IDENTITY=<manifest shared identity_access ID>
IGNITE_SHARED_CLUB_NAME_ENFORCEMENT_RELEASE=1
```

`GOVERNOR_PRINCIPAL` is particularly required by `media_blob_store`. Set the reviewed DEV Wasm-memory limit separately when supported. Use the exact fresh-v3 admission/encrypted-name settings before install; never synthesize removal/rehearsal/push flags. Do not copy mainnet environment values or scheduler secrets.

The management settings API's environment list **replaces the whole list**: read the before-image, preserve existing values, append only the reviewed engine settings and read back. Omit the `controllers` field entirely; this task permits no controller changes. Do not attach cycles to engine calls.

## 5. Install exact DEV modules, with their real constructors

Install only when the reviewed target's `module_hash` is empty/null. Constructor formats:

| Services | Candid argument |
|---|---|
| shared `identity_access`, `placement_registry`, `shard_router` | `(record { governor = principal "<verified DEV governor>" })` |
| shared `migration_coordinator`, `secret_workload_identity`, and Motoko group services except the blob store | `(principal "<verified DEV governor>")` |
| `timer_jobs`, `media_blob_store`, `frontend` | `()` |

Install shared identity/infrastructure, then G1's thirteen services, then G2's thirteen, and frontend last. The manifest binds each step to the exact provisioned name/ID.

Use the operator's documented `install_code` management relay in `install` mode, binary-Candid constructors and the reviewed Wasm bytes. Large Wasm uses its documented chunk-upload/install sequence with reviewed hashes. Stop on unknown responses and reconcile by readback; do not blindly re-execute.

After every install, verify the installed uncompressed module hash and required environment values. Never use `reinstall`. Any later upgrade requires separate review; Motoko enhanced-persistence builds use `wasm_memory_persistence=keep`, while Rust/static-site modules do not blindly inherit that option.

## 6. Reciprocal group wiring — direct governor calls

The manifest's `postInstallCalls` enumerates the exact arguments and IDs for both groups. The same operation uses each group's own services; the shared identity remains single. These calls need a direct transport signed by the constructor's internal governor; the deployment operator does not relay arbitrary application methods.

Important required calls include:

- `timer_jobs.initialize()` in each group; no speculative initialization on services without that method.
- PII `set_club_domain_canister(own club)` and `set_competition_domain_canister(own competition)`.
- Blob store `set_club_domain_canister(own club)` and `set_vault_authority(own vault)`.
- Club `register_media_quota_store(own blob store)` and vault `set_vault_stores(vec own blob store)`.
- Messaging ↔ notification links; notification `set_identity_access_canister(shared identity)` and `set_club_domain_canister(own club)`.
- Club ↔ events/messaging/PII/competition/mini-league links; gallery/vault/competition/event links exactly as declared.
- Both club authorities receive the full vector of this deployment's competition authorities; both competition authorities receive the full vector of its club authorities. Never import PROD authorities into DEV.

Read `read_group_opening_configuration()` using each service's exact Candid return shape after setup; compare all links. Explicit refusals/unknown outcomes stop. Record bounded per-operation intent/result/readback before continuing. Quota registration must preserve its existing authorization and accounting requirements; no quota-recovery flags are enabled.

**Push is not part of this deployment:** no `grant_worker`, queue sender registration or recurring delivery activation is performed until an independent DEV worker/setup is approved. Existing Supabase/mainnet workers stay untouched.

## 7. Shared identity, registry and group registration — fresh-v3

Do **not** call legacy signed recovery provisioning or `pin_owner_test_deletion_registry` for fresh DEV. Set the account admission authority on router, both timers and shared workload using the real `set_account_removal_authority` calls emitted in the manifest; removal remains disabled despite the existing method name. `commission_fresh_opencloud_dev` commissions the complete inventory and membership directory atomically. `placement_registry` uses real `set_policy`/`set_target`; there is no `set_router` method. No workload grant or migration operation is required.

Use `commissioning-request-template.json` and current Candid `ProductionAccountExpectation`: 29 authorization-relevant module hashes are prefilled; supply exact live registry/history acknowledgments before encoding. Identity additionally obtains and checks install history for **all 31** backends itself. No empty proof, fixture receipt, local flag or sampled controller status substitutes for those checks.

The router's real calls are `register_group(group, live_revision)` then `register_group_placement(placement, acknowledged_revision)`, both CAS-bound, with `accepting=false`. Each has twelve group domains plus shared `secret_workload_identity` and its own separate `photo_store`. The explicit engine resource policy permits real zero cycles and requires `min_cycles=0`, retaining heap/capacity/fresh-health gates. Neither G1 nor G2 is opened by this package.

## 8. Frontend upload, encryption and functional acceptance — external actions

Use supplied certified-assets **v0.4.0** and its matched official plugin with the existing DEV publisher, targeting only `h2knm-vaaaa-aaac5-aadqa-cai`. The API is `start_sync`/`upload_chunks`/`execute_operations`; `_headers` and `_redirects` are configuration, not served assets. Do not use the legacy asset API or `.ic-assets.json5`. Follow `frontend-upload/README.md`, verify assets/HTTP policies and certification v2, and preserve `.well-known` callbacks. Unknown upload replies require readback, not reinstall.

Run `acceptance.md` with real signed-in DEV users and real input. Enable no routing/admission or name release just because installation passed. **PROD remains inactive after DEV acceptance; its future release is a different approval.**