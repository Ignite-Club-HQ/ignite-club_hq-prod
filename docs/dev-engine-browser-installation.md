# DEV engine browser installation

## Confirmed destination

- Console: https://opencloud.org
- Engine: `engine-789969b4-e8ba-41b0-90a2-47b4dab699df` (`ignite-dev`).
- Console apps: https://opencloud.org/console/engines/engine-789969b4-e8ba-41b0-90a2-47b4dab699df/apps
- Subnet: `nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae`.
- Reported domain: `ignite-dev--0k3.opencloud.me`; API/certificate trust remains unverified.
- Existing Ignite canisters are not on this engine. The supplied Integrations screenshot shows no console proxy deployed.
- Paul cannot run local computer software. The failed MCP connection is not treated as working access.

## Browser-only route and current limits

The official `deploy-to-cloud-engine` guide documents **Your apps and services → Upload a bundle**. The `icp-cli` bundling reference describes an experimental `.icp` archive containing compiled Wasms, rewritten configuration, init arguments and supported plugin sync inputs. It is not an export of existing accounts or club data.

The official bundle producer is `icp project bundle --output <path>`. Do not invent an archive format or relabel a source ZIP as an installable bundle. Bundles reject script sync steps; they preserve plugin sync steps. Browser upload support does not establish support for arbitrary post-install privileged method calls.

Ignite's existing `engineClosedInstall.ts` is an adapter-injected protocol, not a connected installer. It creates complete group services and a dedicated photo store, then performs reciprocal service configuration through `configureProvisionGroup`. It stops checked/unregistered. A generic bundle upload does not prove those configuration operations happened, nor that console controller ownership satisfies this protocol's sole-operator checks.

Consequently, no upload-ready bundle is produced yet, and no application is repointed.

## Ordered next work

1. Owner creates the **DEV console proxy** under Integrations → Proxy canisters → Deploy a proxy and returns its public canister ID. The official guide says creation consumes the engine balance and future automatic proxy refills also draw from it. This is a paid setup action, not a free connectivity probe. Caffeine need not be enabled.
2. Complete caller-isolated proxy-backed VetKeys in the backend and the remaining bounded, cycle-free cross-subnet call families. A `PROXY_CANISTER_ID` setting alone does not implement encryption. Preserve the existing mainnet path.
3. Verify the browser upload dialog's supported init/configuration mechanism and controller ownership. Implement the missing configuration transport through an officially supported path; do not assume the console can execute arbitrary scripts or use the mainnet CI key without a verified DEV engine grant.
4. Produce the official backend-only bundle using pinned tooling, inspect its complete manifest/Wasms/init inputs and exclude keys, existing ID mappings and data. Include exact source/module provenance. No frontend relocation is required by this route.
5. Upload once to the confirmed DEV engine, retain resulting IDs and verify subnet/controllers/modules and complete service links. Ambiguous creation or configuration results require readback, not another upload.
6. Verify a fresh isolated DEV club: Internet Identity continuity, encrypted upload/decryption, membership denials, chats, timers, native push, upgrade preservation and readable backup/restore. Installation is not admission approval.
7. Repoint only the approved DEV test experience after verification. Existing clubs and PROD remain unchanged.

## Not authorized or completed

No deployment, proxy creation, settings write, club migration, scheduler activation, production workflow change or live hosting change occurred. Real engine encryption, browser installation/configuration and phone acceptance remain unverified.

## Sources checked

- https://skills.internetcomputer.org/.well-known/skills/deploy-to-cloud-engine/SKILL.md
- https://skills.internetcomputer.org/.well-known/skills/icp-cli/references/bundling.md
- https://skills.internetcomputer.org/.well-known/skills/cloud-engine-canisters/SKILL.md
- `frontend/src/live/engineClosedInstall.ts`
- `docs/cloud-engine-future-switch.md`