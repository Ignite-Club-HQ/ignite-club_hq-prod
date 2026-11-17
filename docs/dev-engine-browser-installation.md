# DEV engine browser installation

## Confirmed destination

- Console: https://opencloud.org
- Engine: `engine-789969b4-e8ba-41b0-90a2-47b4dab699df` (`ignite-dev`).
- Console apps: https://opencloud.org/console/engines/engine-789969b4-e8ba-41b0-90a2-47b4dab699df/apps
- Subnet: `nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae`.
- Reported domain: `ignite-dev--0k3.opencloud.me`; API/certificate trust remains unverified.
- Existing Ignite canisters are not on this engine. Paul's 17 November 00:55 UTC Integrations screenshot shows one deployed console proxy: `ynolw-eyaaa-aaaaj-qspkq-cai`, with a displayed balance of 2.49 T cycles. This is owner-supplied console evidence, not verified deployment access or a successful encryption call.
- Paul cannot run local computer software. The failed MCP connection is not treated as working access.
- Read-only SDK query on 17 November confirms `ynolw-eyaaa-aaaaj-qspkq-cai.get_allowed_subnet()` returns exactly `nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae`. This verifies the proxy's advertised subnet, not successful encrypted engine calls.
- The engine domain currently redirects to console engine `engine-789969b4-e8ba-41b0-90a2-47b4da69909f`, which differs from the earlier transcribed ID above. The latest owner prompt screenshot also shows this latter ID. Treat the earlier transcription as unverified; verify registry/operator identity before binding any installation. The supplied subnet is independently matched by the proxy query.

## Browser-only route and current limits

The official `deploy-to-cloud-engine` guide documents **Your apps and services → Upload a bundle**. The `icp-cli` bundling reference describes an experimental `.icp` archive containing compiled Wasms, rewritten configuration, init arguments and supported plugin sync inputs. It is not an export of existing accounts or club data.

The official bundle producer is `icp project bundle --output <path>`. Do not invent an archive format or relabel a source ZIP as an installable bundle. Bundles reject script sync steps; they preserve plugin sync steps. Browser upload support does not establish support for arbitrary post-install privileged method calls.

Ignite's existing `engineClosedInstall.ts` is an adapter-injected protocol, not a connected installer. It creates complete group services and a dedicated photo store, then performs reciprocal service configuration through `configureProvisionGroup`. It stops checked/unregistered. A generic bundle upload does not prove those configuration operations happened, nor that console controller ownership satisfies this protocol's sole-operator checks.

Consequently, no upload-ready bundle is produced yet, and no application is repointed.

## Packaging validation — 17 November

Status: **HOLD — not upload-ready**. Paul requested an engine-compatible `.icp` or `.tar.gz` bundle. No archive is handed over because packaging the current modules would retain runtime and installation failures.

- The official CLI 1.7.0 Linux archive was downloaded and SHA-256 verified against the GitHub release digest (`aa5f0c102ae66e414fa43e119a249f4237998141b001cbccd523a81dadc7d01d`). The executable cannot yet run in this sandbox: after isolating missing libdbus and zlib in `/tmp`, libsystemd is still missing. No official bundle command or backend compilation has completed.
- `backend/pii_access_control/src/main.mo` still directly calls `ManagementCanister.vetKdPublicKey` (line 598) and `vetKdDeriveKey` (lines 634, 801, 1060, 1164, 1205). These helpers are incompatible with engine cross-subnet/cycle rules. All six call sites need the same configured proxy adapter while retaining the direct mainnet path and existing authorization rechecks. No proxy configuration or cryptographic code was changed.
- Two explicit HTTPS payments remain: `backend/club_domain/src/main.mo:5328` (20 billion cycles) and `backend/notification_queue/src/main.mo:1724` (300 million cycles). Engine canisters hold zero cycles; use cost-aware local HTTPS wrappers, not the proxy. Existing Supabase/native delivery must remain unchanged.
- Targeted Rust source inspection found existing bounded-wait calls and no legacy `ic_cdk::call`, `call_with_payment`, `.with_cycles`, or `unbounded_wait` sites. This is not real-engine interoperability acceptance or proof of every Motoko cross-subnet path.
- Checked-in backend recipes include the mainnet deployment governor sentinel. A browser bundle must bind the authorized DEV engine governor correctly before creation; copying those init arguments unchanged would not establish operator authority.
- Public OpenCloud console help confirms official project bundles and **setup plugins** are supported; plugins require Chrome 137+ or Edge. Therefore browser setup is not categorically unavailable. The actual supported plugin ABI, dynamic initialization and complete reciprocal configuration/controller readback remain unverified for Ignite. Ordinary CLI script sync steps are still rejected by the official bundler.
- No compiled complete-service inventory, stable-layout compatibility check, disposable install/upgrade, encrypted round trip, or browser installation test has passed for an engine candidate. No mainnet-compatible bundle is certified.

Next implementation is the shared/configured crypto adapter and cost-aware HTTPS paths, followed by the supported browser setup plugin and exact DEV operator binding. Only then compile the complete backend, produce the official bundle, inspect every archive entry/hash/init input, and rehearse it before owner upload. Do not substitute a source archive or renamed tarball.

## Ordered next work

1. **Completed by the owner:** DEV console proxy `ynolw-eyaaa-aaaaj-qspkq-cai` is shown deployed. Future automatic proxy refills draw from the engine balance. Do not create another proxy; Caffeine need not be enabled.
2. Complete caller-isolated proxy-backed VetKeys in the backend and the remaining bounded, cycle-free cross-subnet call families. A `PROXY_CANISTER_ID` setting alone does not implement encryption. Preserve the existing mainnet path.
3. Implement and validate the console-supported setup plugin's init/configuration mechanism and controller ownership. Public console help establishes plugin support, not Ignite's specific setup ABI; do not assume arbitrary scripts or use the mainnet CI key without a verified DEV engine grant.
4. Produce the official backend-only bundle using pinned tooling, inspect its complete manifest/Wasms/init inputs and exclude keys, existing ID mappings and data. Include exact source/module provenance. No frontend relocation is required by this route.
5. Upload once to the confirmed DEV engine, retain resulting IDs and verify subnet/controllers/modules and complete service links. Ambiguous creation or configuration results require readback, not another upload.
6. Verify a fresh isolated DEV club: Internet Identity continuity, encrypted upload/decryption, membership denials, chats, timers, native push, upgrade preservation and readable backup/restore. Installation is not admission approval.
7. Repoint only the approved DEV test experience after verification. Existing clubs and PROD remain unchanged.

## Not authorized or completed

Paul created the DEV console proxy. No Ignite deployment, settings write, club migration, scheduler activation, production workflow change or live hosting change was performed here. Real engine encryption, browser installation/configuration and phone acceptance remain unverified.

## Sources checked

- https://skills.internetcomputer.org/.well-known/skills/deploy-to-cloud-engine/SKILL.md
- https://skills.internetcomputer.org/.well-known/skills/icp-cli/references/bundling.md
- https://skills.internetcomputer.org/.well-known/skills/cloud-engine-canisters/SKILL.md
- `frontend/src/live/engineClosedInstall.ts`
- `docs/cloud-engine-future-switch.md`