# Exact supported deployment sequence for ChatGPT

**Fresh-v3 supersedes the legacy held bootstrap sections below. Follow `commissioning.md` and the fresh-v3 manifest for exact installation flags and steps.** No witness install/signature is required; the existing empty witness stays untouched. All receiver admission modes and identity pins are immutable in the supplied fresh modules. Global erasure/recovery are unavailable, and initial commissioning cannot rearm restore/upgrade state. Complete group placements are emitted as `groups[].registerGroupPlacementCall` with explicitly reviewed/live revisions, never guessed zeros.

**Scope: the existing 32 provisioned DEV IDs in `dev.json` only. No new canisters, PROD installation, reinstall, CI, controller replacement, live routing/DNS changes, Supabase operations or data migration.**

The generated `dev.manifest.json` contains every DEV target ID, constructor, candidate settings, group-domain link call and ordered install inventory. It remains `executable:false`. Use it as a review, not a runner.

## 1. Read-only identity and inventory confirmation

Use the OpenCloud/ICP connector's supported operations to open the engine operator, read its current API/Candid and app records, and establish the caller's engine-origin principal. Compare `ignite_dev_v2` with all 32 exported mappings; independently read each canister's subnet, current module hash and effective controllers.

Stop if any target is absent, duplicated, belongs to PROD/another app/subnet, already contains code unexpectedly, or lacks the expected existing operator/owner access. **Do not repair by creating a replacement, changing controllers or reinstalling.** Report the difference to Paul.

Choose and verify the exact internal DEV governor principal and frontend-publishing principal; fill the config only after the owner confirms them. These are signing roles, not the operator/proxy IDs. Keep DEV and PROD governor/publisher identities separate. Never paste or package private keys or delegation tokens.

## 2. Chain-key proxy verification

Read `get_allowed_subnet` on `ynolw-eyaaa-aaaaj-qspkq-cai`; it must return the supplied engine subnet. Read its public Candid and funding metadata; they must match the reviewed API and engine binding. This was observed read-only during preparation, but recheck before installation.

The deployment operator is `s53an-5aaaa-aaac5-aaaaa-cai`. It must not replace `PROXY_CANISTER_ID`. Public proxy readback does not authorize paid derivations or prove encryption acceptance.

## 3. Build and review artifact bytes

Build the staged original sources using the pinned existing recipes/compilers. Review the manifest's candidate artifact hashes and exact Candid files. There are eighteen unique backend implementations, applied to 31 backend IDs. Build the standalone frontend separately and check its assets/ID scan. Do not use ordinary mainnet or production workflows to do this.

Unknown constructor principals, resource inputs, public frontend configuration, unresolved name/bootstrap/resource policy, or a failed artifact audit keep installation held.

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

Existing real methods are `identity_access.provision_production_account_inventory`, `pin_owner_test_deletion_registry`, and `configure_membership_directory`; they take the current generated Candid evidence/binding types, not bare principals invented here. `shard_router.set_deletion_authority` exists, but does not by itself commission all receivers. `placement_registry` uses `set_policy`/`set_target`; there is no fabricated `set_router` call. `secret_workload_identity.register_workload` needs a separately approved workload principal and scopes; migration_coordinator remains unused.

The separate `commission_fresh_opencloud_dev` path resolves initial bootstrap without a recovery signature/witness; use `commissioning.md`. No empty proof, fixture receipt, local flag or sampled controller status substitutes for its full install-history, complete inventory and admission-only checks.

The router's real calls are `register_group(group, live_revision)` then `register_group_placement(placement, acknowledged_revision)`, both CAS-bound, with `accepting=false`. Each has twelve group domains plus shared `secret_workload_identity` and its own separate `photo_store`. The explicit engine resource policy permits real zero cycles and requires `min_cycles=0`, retaining heap/capacity/fresh-health gates. Neither G1 nor G2 is opened by this package.

## 8. Frontend upload, encryption and functional acceptance — HELD

After a supported asset uploader exists, upload only the isolated frontend's inventoried files to `h2knm-vaaaa-aaac5-aadqa-cai`. Verify its `.well-known` declarations and callbacks, canonical `.icp.net` II origin, network API host/certification and the absence of old deployment IDs.

Run `acceptance.md` with real signed-in DEV users and real input. Enable no routing/admission or name release just because installation passed. **PROD remains inactive after DEV acceptance; its future release is a different approval.**