# OpenCloud DEV commissioning (fresh-install package v3)

Everything below runs as the **internal governor** unless stated. Stop and read back on any uncertain reply; never replay blindly.

## Prerequisites (owner)
1. Exact empty 32-canister inventory, controllers, subnet (ChatGPT verification).
2. `dev.json`: `controllers.{owner,governor,frontendPublisher}`, `engineSettings.devWasmMemoryLimit`, each group's `maxClubs`/`heapBudgetBytes`.
3. No witness or signing key is needed for initial DEV commissioning. The existing empty witness remains untouched. `manifest.accountProtectionBuild.compileTimeEnv` contains immutable DEV-only installation pins and Rust infrastructure removal-off mode; these are already baked into the supplied affected modules.
4. All 31 backend canisters must have complete management history (at most 100 changes), exactly one `install`, no upgrade/reinstall/uninstall/snapshot load or unknown history variants. Legitimate create/controller history is allowed; initial governor account and installation counters are expected, not fabricated as zero.

## Install
Apply the exact `manifest.canisters[].settings.environmentVariables` **before install**; preserve unrelated settings and omit controllers. All Motoko receivers have `IGNITE_ACCOUNT_ADMISSION_RELEASE=1`, `IGNITE_ACCOUNT_SERVICE_IDENTITY=<DEV identity>`, removal/rehearsal flags absent. PII also has `VETKD_KEY_NAME=key_1` and the existing proxy. Identity has both encrypted-name release flags and its Group 1 PII pin from installation, but fresh-mode account writes and name-source access stay closed until commissioning. Do not toggle release settings after the lifecycle receipt is committed.

Install using `manifest.installOrder`, install-only when module hash is null, then perform and read back `manifest.postInstallCalls`. No imported user data, no first-user profile creation before commissioning. Memory limit: `4294967296` bytes per DEV canister; group heap budget `3221225472` bytes, capacity 100 clubs each. These are maxima, not reservations or verified engine aggregate capacity.

Both clubs additionally have their exact router/group/DEV-target placement binding, placement-required protection and the club-name release flag from installation. The fresh artifacts force admission-only mode and the DEV identity in compiled Motoko code, and force placement-required on clubs; clearing runtime flags cannot bypass those guards. Use the existing set-once `link_display_identity_authority` call in `postInstallCalls` for both clubs; do not use the rehearsal-only identity setter.

Both PII services also pin the private-name verifier to the DEV identity, enable authorized club-name reads and require shared club-name ciphertext from the first club. These are immutable in fresh PII code; private-profile rehearsal stays off. The existing proxy route/key name and final membership/account checks before returning encrypted vetKeys are retained.

## Commissioning (`manifest.sharedCommissioning`)
| # | Call | Notes |
|---|------|-------|
| 3 | `shard_router.register_group` × 2 | `groups[].registerGroupCall`; router IDs **base** (g1_ canisters) and **g2**, closed, `min_cycles = 0`. |
| 3b | `shard_router.register_group_placement` × 2 | Complete same-subnet placements, exact DEV host/deployment and current acknowledged revision; additional subnets disabled. |
| 4 | `shard_router.set_deletion_authority(identity_access)`; `set_account_removal_authority(identity_access)` on router, both timers and shared workload service | Identity binding only; compiled infrastructure removal is off. No workload is registered. |
| 5 | `read_production_account_history_revision()`; `review_production_account_inventory(Expectation, history_revision)` | Complete independently checked live inventory and **29 authority module hashes**; shared placement/migration are additionally lifecycle-checked by the new path, for 31 backends total. No signature. |
| 6 | `identity_access.commission_fresh_opencloud_dev(Expectation)` | Same request as review; atomic one-use commit, complete first-install history checks, no witness call or recovery receipt. Save returned receipt. |
| 7 | `identity_access.authorize_production_member_access(binding)` | commissions 24 member readers; on engine also the name-source PII services |
| 8 | `identity_access.configure_membership_directory(binding, [base club, g2 club], 1)` | |
| 9 | `identity_access.read_fresh_opencloud_dev_commissioning()` | Verify every live backend lifecycle against the saved receipt; verify membership configuration and encrypted-name authority. |
| — | open `base` via existing owner-opening approval | g2 stays closed |

Never set `IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL`.

### Expectation requirements

Use the actual complete `read_group_registry_page` result and `read_removal_media_registry` from both clubs, not a invented receipt. `Expectation` is defined in `candid/identity_access.did`: `identity`, `modules` (principal + 32 raw SHA-256 bytes), and `inventory { groups { binding; history_revision; snapshot }; supplemental; media }`. Binding must use exact DEV identity/router/host, `target_alias=deployment_id=opencloud-dev`, `network_kind=cloud_engine`, and live decimal revisions. Supplemental inventory is router plus the two group blob stores on the supplied subnet. All names/principals and all 29 authority hashes must match this package. Do not assume live registry revisions or counters are zero.

### Restore and upgrade policy

There is no reset/rearm endpoint. Identical commissioning retry only returns the existing receipt after live validation; a different request is refused. Management snapshot loads/reinstalls change lifecycle counts and stop fresh-mode authorization even if identity and other services are restored together. Ordinary updates do not change these counts. Identity upgrades explicitly refuse in this initial mode; a changed receiver lifecycle stops its scoped authorization. Any DEV upgrade/restore needs a separately reviewed lifecycle procedure, not reuse of commissioning. Global account erasure/recovery are unavailable even if ordinary admission is disabled later. Existing mainnet/PROD recovery controls remain unchanged.

## Frontend upload
`frontend-assets/` (exact inventory + SHA-256 in `frontend-artifacts.json`) is the complete asset tree for `frontend` (`h2knm-vaaaa-aaac5-aadqa-cai`). Install the supplied **certified-assets v0.4.0** Wasm first, with the existing static-site recipe's matched upload plugin. Upload served files at exact relative paths/MIME types; parse `_headers` and `_redirects` as configuration, preserve `.well-known/*`, and use certification v2. The correct API is `upload_chunks` + `execute_operations`, **not** the legacy `create_batch`/`commit_batch` API or `.ic-assets.json5`. Signer = existing DEV frontend publisher. Verify served hashes, certified responses, SPA rewrites and headers by readback. No CI, no mainnet frontend touched.
