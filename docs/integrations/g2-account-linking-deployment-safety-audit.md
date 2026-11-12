# DEV G2 linked-account reader — deployment safety audit
**12 November 2026 | Draft only | No DEV/PROD release permission**

## Scope and result

The user-facing account-linking test runs the **actual Club Domain** against a **separately compiled test identity** and independent recovery witness in disposable PocketIC. That Rust test identity is compiled with Cargo feature `isolated-g2-chain-fixture` **and** `IGNITE_ISOLATED_G2_FIXTURE_BUILD=POCKETIC_ONLY_NOT_DEPLOYABLE`. The standard binary continues to set `ACTIVE_G2_READER_INDEPENDENT_RECOVERY_APPROVED=false`.

Test success cannot authorise release. Even the normal (non-fixture) reader remains hard-disabled in source. Releasing it requires its independent approval, governor inventory verification and an explicit separate security-reviewed patch.

## Deployment entry points inspected and protected by this PR

| Entry point | Defense |
| --- | --- |
| `backend/identity_access/build.rs` | Compiler refuses the fixture Cargo feature unless the exact disposable PocketIC marker is supplied |
| `scripts/deploy-mainnet.sh` | Refuses test marker/feature in operator build env; compiles identity recipe and scans the actual raw/gzip final WASM before auto deploy (DEV or PROD target) |
| `.github/workflows/upgrade-all-groups.yml` | Checks environment before build and inspects exact identity build artifact in staged all-groups release set before any mainnet upgrade |
| `.github/workflows/promote-icp-prod.yml` | Rejects fixture environment, prebuilds and checks the actual identity recipe artifact before the PROD identity upgrade |
| `scripts/identity-g2-fixture-release-guard.mjs` | Parses WASM export section and refuses `fixture_g2_authorize_reader`, malformed artifacts and unapproved build settings. Supports raw and gzip WASM. |
| `.github/workflows/ci.yml` | Runs fixture guard regression tests including synthetic forbidden export and source checks for the principal release entry points |

**Residual limitation:** the ICP CLI may rebuild after preflight. These protections are not a substitute for verifying the exact installed module hash before and after upgrading, or for review of a future changed build recipe. Manually running `icp` CLI directly outside the guarded entry points remains an operator risk. Release approval must prohibit bypassing the guarded paths. This audit does not claim to inventory every possible external controller, copied repository or deployment job.

Do **not** run the PocketIC fixture with ordinary production credentials, do not use `--all-features` in release, and do not set the marker in production environment variables.

## Read-only DEV checks — currently blocked without governor

Observed using the connected app-admin identity:
- Shared `identity_access` `read_group_opening_configuration()` returned `Err("Forbidden")`.
- Group 2 `club_domain` `read_group_opening_configuration()` trapped `Governor required`.
- Group 2 `club_domain` `read_account_protection_configuration()` returned `Err("Configured identity authority required")`.

These are **not** full inventory results, and they do not establish that an ordinary user's Internet Identity has the governor authority. Do not bypass the guards.

Using a **reviewed existing governor credential** through an approved, read-only workflow (never send keys to chat), obtain:

1. Shared identity, router and Group 2 club canister IDs, modules' SHA256 hashes, controllers, cycles, running status, account-protection mode and governor principal.
2. `identity_access.read_group_opening_configuration()` values, including registry/revision, `ordinary_member_access`, `account_admission_released`, club readers and global deletion/recovery controls.
3. `club_domain.read_group_opening_configuration()` and `read_account_protection_configuration()` with exact shared identity binding, protocol, rehearsal=false and deletion/removal controls unchanged.
4. Full current router registry/placements, accepted opening state and exact Group 2 canister IDs/revision; no inferred IDs from old manifests.
5. Separate recovery witness controller/program hash, pinned signer public key fingerprint (never a private key), accepted signed baseline, current disarming/arming and removal-history generations.
6. Tested upgrade plan and rollback: preserved stable memory, existing test club and U10 team, no creation, no reinstall, no changed keys, no reused stale signature.

Review evidence independently; if even one check is unknown or mismatched, stop. DEV's canisters run on actual ICP mainnet.

## Other existing blocker

`auth-release-policy` CI fails because `scripts/workflow-env-names.test.mjs` does not yet allowlist an existing production rollout workflow. Treat this as a separate production-security review; do not broaden its allowlist in an identity change just to make CI green.

## Release decision

**No merge, mainnet deployment, signature commission, governor grant, account reader activation or PROD modification** under PR #1480. Keep test account, existing test club and U10 team intact. The next phase is governor-authorised evidence gathering, independent security review of the exact installed canisters and signed DEV-only upgrade manifest.
