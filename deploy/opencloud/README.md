# Ignite OpenCloud DEV preparation

**Status: all eighteen backend implementations built and hashed; not installed or accepted. Frontend installation/functional acceptance are held. PROD is inactive.**

The provisioned applications are `ignite_dev_v2` and `ignite_prod_v2`, on engine `ignite-prod`. Each has **32 distinct canisters**: six shared services and two groups of thirteen services. No new canisters, controller changes, CI, DNS changes, mainnet changes or data migration are authorized by these files.

## Deliverables

- `dev.json`: populated DEV inventory, separate operator/chain-key proxy, unresolved owner/governor/publisher and resource inputs.
- `prod.json`: equivalent **inactive** PROD template with its own 32 IDs.
- `infrastructure.export.json`: original owner-supplied export; creation/app responses are not independently verified inventory evidence.
- `proxy-interface.did`: snapshot of the chain-key proxy's publicly readable Candid interface.
- `compatibility.md`: assessed compatibility and actual blockers, including existing mainnet-only authorization pins.
- `chatgpt-steps.md`: install/settings/wiring sequence and transport limitations.
- `acceptance.md`: real DEV acceptance checklist, including encrypted names/photos and denial tests.
- `scripts/opencloud/`: mapping/manifest/staging/artifact checks and anonymous read-only proxy verification. These commands never install code, create canisters, sign in or invoke CI.
- The handover ZIP includes eighteen compiled backend `.wasm.gz` files, their Candid contracts, the 32-target DEV manifest and source/artifact fingerprints. Frontend Wasm/assets are not included; the listed transport/name/bootstrap/resource blockers remain real holds, not completed release steps.

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

In that staged `build/` directory, a trusted build operator runs the pinned `icp` **1.7.0** and `ic-wasm` **1.0.0** `icp build` command. It requires the normal existing Rust/Motoko tools and recipe downloads; it needs no login. This build succeeded locally for all eighteen backend implementations. **Do not run `icp deploy`, `icp sync`, install, create, or a mainnet release script.** Collect its final extensionless recipe outputs with:

```sh
node scripts/opencloud/deployment.mjs collect deploy/opencloud/work/dev-candidate
```

This produces gzip Wasm files, per-file SHA-256, uncompressed module hashes and Candid hashes for the eighteen unique backend service implementations reused across the 31 backend receivers. It is not permission to install them.

After owner/signing/resource/public-key inputs are verified and completed, the standalone frontend artifact command is:

```sh
node scripts/opencloud/deployment.mjs check deploy/opencloud/dev.json deploy/opencloud/prod.json
node scripts/opencloud/frontend-artifacts.mjs deploy/opencloud/work/dev-candidate deploy/opencloud/prod.json
```

It uses the existing frontend, the shared dependency installer and isolated output paths; it does not change the running preview's environment. Known existing-deployment IDs in generated frontend files **fail** the artifact check; it never rewrites authorization pins to make a check pass. Remaining engine-specific name/group commissioning must be completed before a functional frontend can be accepted.

## What is not complete

No code has been installed on OpenCloud, no assets uploaded, no live routing changed and no production data moved. Real DEV sign-in → club → event/chat → encrypted photo/name readback requires owner-authorized transport and the compatibility blockers in the accompanying assessment to be resolved. Do not describe a passing offline fixture or a successful Wasm installation as that acceptance.

## Checks completed

- 20 offline package/artifact/hosting/key-isolation checks passed.
- 51 focused frontend checks passed in each existing backend mode (102 total), including engine boot/profile fail-closed cases and existing email/mainnet compatibility.
- Existing local Motoko direct/proxy route policy ran successfully; the mainnet direct route remains unchanged.
- The preview build reports OK. No real-user OpenCloud session, full engine encryption round trip or frontend asset installation has been exercised.