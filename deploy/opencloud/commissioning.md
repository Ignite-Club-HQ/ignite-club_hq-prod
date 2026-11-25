# OpenCloud DEV commissioning (package v2)

Everything below runs as the **internal governor** unless stated. Stop and read back on any uncertain reply; never replay blindly.

## Prerequisites (owner)
1. Exact empty 32-canister inventory, controllers, subnet (ChatGPT verification).
2. `dev.json`: `controllers.{owner,governor,frontendPublisher}`, `engineSettings.devWasmMemoryLimit`, each group's `maxClubs`/`heapBudgetBytes`.
3. `dev.json.accountProtection`: `approverPublicKey` (Paul's independent signer), `witness`, `witnessModuleHash`, `witnessController` for an **independent recovery witness outside the 32 canisters**. These are compile-time pins: rebuild `identity_access` with `manifest.accountProtectionBuild.compileTimeEnv` set. Until then steps 5–9 are held (fail closed).

## Install
Settings first (every canister `IGNITE_CLOUD_ENGINE=1`, `GOVERNOR_PRINCIPAL`; PII adds `VETKD_KEY_NAME=key_1`, `PROXY_CANISTER_ID=ynolw-eyaaa-aaaaj-qspkq-cai`), then `manifest.installOrder`, install-only when module hash is empty, then `manifest.postInstallCalls`.

## Commissioning (`manifest.sharedCommissioning`)
| # | Call | Notes |
|---|------|-------|
| 3 | `shard_router.register_group` × 2 | `groups[].registerGroupCall`; router IDs **base** (g1_ canisters) and **g2**, closed, `min_cycles = 0`. |
| 4 | `shard_router.set_deletion_authority(identity_access)` | |
| 5 | identity read-only protection review → owner signs | requires rebuilt identity_access |
| 6 | `identity_access.provision_production_account_inventory(SignedApproval)` | engine binding, witness checked live |
| 7 | `identity_access.authorize_production_member_access(binding)` | commissions 24 member readers; on engine also the name-source PII services |
| 8 | `identity_access.configure_membership_directory(binding, [base club, g2 club], 1)` | |
| 9 | identity settings `IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE=1`, `IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE=1`, `IGNITE_SECURE_ADULT_NAME_PII=<g1_pii_access_control>` | only after 6–8 read back |
| — | open `base` via existing owner-opening approval | g2 stays closed |

Never set `IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL`.

## Frontend upload
`frontend-assets/` (708 files, inventory + SHA-256 in `frontend-artifacts.json`) is the complete asset tree for `frontend` (`h2knm-vaaaa-aaac5-aadqa-cai`). Requirements: static-site/asset-canister Wasm installed first; upload **every** file at its relative path with its `Content-Type`; keep `.ic-assets.json5` headers and `.well-known/*`; signer = frontend publisher; commit as one batch and verify each SHA-256 by readback. No CI, no mainnet frontend touched.
