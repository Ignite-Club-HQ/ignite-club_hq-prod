# Ignite OpenCloud DEV preparation

**Status: fresh-install DEV commissioning is implemented; use the complete fresh-v3 package and `commissioning.md`. Nothing is installed or live-accepted here. PROD is inactive.**

The provisioned applications are `ignite_dev_v2` and `ignite_prod_v2`, on engine `ignite-prod`. Each has **32 distinct canisters**: six shared services and two groups of thirteen services. No new canisters, controller changes, CI, DNS changes, mainnet changes or data migration are authorized by these files.

## Deliverables

- `dev.json`: populated DEV inventory, separate operator/chain-key proxy, existing owner/governor/publisher and DEV memory/group limits; fresh-install admission-only mode.
- `prod.json`: equivalent **inactive** PROD template with its own 32 IDs.
- `infrastructure.export.json`: original owner-supplied export; creation/app responses are not independently verified inventory evidence.
- `proxy-interface.did`: snapshot of the chain-key proxy's publicly readable Candid interface.
- `compatibility.md`: assessed compatibility and actual blockers, including existing mainnet-only authorization pins.
- `chatgpt-steps.md`: install/settings/wiring sequence and transport limitations.
- `acceptance.md`: real DEV acceptance checklist, including encrypted names/photos and denial tests.
- `scripts/opencloud/`: mapping/manifest/staging/artifact checks and anonymous read-only proxy verification. These commands never install code, create canisters, sign in or invoke CI.
- The fresh-v5 handover (fresh-v3 with only `identity_access` rebuilt so no `canister_info`/management history is needed on OpenCloud DEV) includes eighteen backend implementations, frontend asset-canister Wasm, complete frontend assets, Candid contracts, the 32-target manifest and checksums. No witness artifact/install action is included. External transport, lifecycle semantics and real encrypted/user acceptance remain live requirements.

Generated manifests and templates are review output, not committed deployment authority. Generated workspaces stay under `deploy/opencloud/work/`. Backend source and published application code remain in the existing repository; this is not a replacement app.

## Verified public proxy facts

| Role | Principal |
|---|---|
| Engine deployment operator | `s53an-5aaaa-aaac5-aaaaa-cai` |
| Console chain-key proxy | `ynolw-eyaaa-aaaaj-qspkq-cai` |
| Engine subnet | `nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae` |

Anonymous public queries on 25 November 2026 reported the matching allowed subnet and funding engine ID `engine-789969b4-e8ba-41b0-90a2-47b4da69909f`. The publicly fetched interface matches the existing `EngineVetKd` request/result types. Its SHA-256 is `93d4737378d94187b7a88f893d81e8548ea54e6664994944d55c8e06b19310b4`.

These observations **do not prove** engine-caller authorization, successful vetKey derivation, device decryption, current effective controllers or release readiness. No paid derivation, settings mutation or payment was performed.

## Offline commands, from the existing repository

```sh
node --test scripts/opencloud/*.test.mjs frontend/scripts/prepare-canister-dist-opencloud.test.mjs
node scripts/opencloud/deployment.mjs manifest deploy/opencloud/dev.json deploy/opencloud/prod.json
node scripts/opencloud/deployment.mjs prepare deploy/opencloud/dev.json deploy/opencloud/prod.json deploy/opencloud/work/dev-candidate
```

The last command stages the original backend recipes and sources with the fresh-engine PII route enabled **only in the copy**. Unresolved constructors/settings remain held, but source compilation itself does not need a signing identity.

In that staged `build/` directory, a trusted build operator uses `manifest.accountProtectionBuild.compileTimeEnv` for the fresh identity and infrastructure modules and the pinned `icp` **1.7.0** / `ic-wasm` **0.9.11** `icp build` command. The stager pins Motoko receiver admission-only modes and the exact identity in the source copy, leaving ordinary source unchanged. No login is needed. **Do not run `icp deploy`, `icp sync`, install, create, or a mainnet release script.** Collect final extensionless recipe outputs with:

```sh
node scripts/opencloud/deployment.mjs collect deploy/opencloud/work/dev-candidate
```

This produces gzip Wasm files, per-file SHA-256, uncompressed module hashes and Candid hashes for the eighteen unique backend service implementations reused across the 31 backend receivers. It is not permission to install them.

No new signing key or witness is required for initial DEV. After verifying the existing governor/publisher and public frontend configuration, the standalone frontend artifact command is:

```sh
node scripts/opencloud/deployment.mjs check deploy/opencloud/dev.json deploy/opencloud/prod.json
node scripts/opencloud/frontend-artifacts.mjs deploy/opencloud/work/dev-candidate deploy/opencloud/prod.json
```

It uses the existing frontend, the shared dependency installer and isolated output paths; it does not change the running preview's environment. Known existing-deployment IDs in generated frontend files **fail** the artifact check; it never rewrites authorization pins to make a check pass. Remaining engine-specific name/group commissioning must be completed before a functional frontend can be accepted.

## What is not complete

No code has been installed on OpenCloud, no assets uploaded, no live routing changed and no production data moved. Real DEV sign-in → club → event/chat → encrypted photo/name readback requires owner-authorized transport, current inventory/lifecycle verification and successful acceptance; no recovery witness or approver signer is required by the implemented initial path. Do not describe a passing offline fixture or a successful Wasm installation as that acceptance.

## Checks completed

- 21 current offline package/artifact/hosting/key-isolation checks passed.
- Backend regression suites passed: 261 identity, 59 router and 9 timer tests; first-install/fresh-admission/restore rejection cases are included.
- 18 current focused encryption/environment frontend checks passed in each existing backend mode (36 total), alongside the earlier 51-per-mode preparation checks.
- Existing local Motoko direct/proxy route policy ran successfully; the mainnet direct route remains unchanged.
- The preview build reports OK. No real-user OpenCloud session, full engine encryption round trip or frontend asset installation has been exercised.