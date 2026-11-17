# DEV engine browser installation

## Confirmed destination

- Console: https://opencloud.org
- Engine: `engine-789969b4-e8ba-41b0-90a2-47b4dab699df` (`ignite-dev`).
- Console apps: https://opencloud.org/console/engines/engine-789969b4-e8ba-41b0-90a2-47b4dab699df/apps
- Subnet: `nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae`.
- Reported domain: `ignite-dev--0k3.opencloud.me`; API/certificate trust remains unverified.
- Existing Ignite canisters are not on this engine. Paul's 17 November 00:55 UTC Integrations screenshot shows one deployed console proxy: `ynolw-eyaaa-aaaaj-qspkq-cai`, with a displayed balance of 2.49 T cycles. This is owner-supplied console evidence, not verified deployment access or a successful encryption call.
- Paul cannot run local computer software. The failed MCP connection is not treated as working access.

## Browser-only route and current limits

The official `deploy-to-cloud-engine` guide documents **Your apps and services → Upload a bundle**. The `icp-cli` bundling reference describes an experimental `.icp` archive containing compiled Wasms, rewritten configuration, init arguments and supported plugin sync inputs. It is not an export of existing accounts or club data.

The official bundle producer is `icp project bundle --output <path>`. Do not invent an archive format or relabel a source ZIP as an installable bundle. Bundles reject script sync steps; they preserve plugin sync steps. Browser upload support does not establish support for arbitrary post-install privileged method calls.

Ignite's existing `engineClosedInstall.ts` is an adapter-injected protocol, not a connected installer. It creates complete group services and a dedicated photo store, then performs reciprocal service configuration through `configureProvisionGroup`. It stops checked/unregistered. A generic bundle upload does not prove those configuration operations happened, nor that console controller ownership satisfies this protocol's sole-operator checks.

Consequently, no upload-ready bundle is produced yet, and no application is repointed.

## Ordered next work

1. **Completed by the owner:** DEV console proxy `ynolw-eyaaa-aaaaj-qspkq-cai` is shown deployed. Future automatic proxy refills draw from the engine balance. Do not create another proxy; Caffeine need not be enabled.
2. Complete caller-isolated proxy-backed VetKeys in the backend and the remaining bounded, cycle-free cross-subnet call families. A `PROXY_CANISTER_ID` setting alone does not implement encryption. Preserve the existing mainnet path.
3. Verify the browser upload dialog's supported init/configuration mechanism and controller ownership. Implement the missing configuration transport through an officially supported path; do not assume the console can execute arbitrary scripts or use the mainnet CI key without a verified DEV engine grant.
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

## Candidate built 17 November 2026

The official CLI 1.7.0 generated a backend-only 9.1 MiB `.tar.gz` candidate (18 services, one official v0.2 setup plugin, and its 39-operation links input). All 18 module pins and plugin pin match, all modules/component validate with wasm-tools 1.249.0, owner principal checksum passes, and 35 existing/focused engine policy tests pass.

Owner: `4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae`. PII uses `key_1` and proxy `ynolw-eyaaa-aaaaj-qspkq-cai`; only staged fresh-engine source enables proxy route initialization. Normal source preserves direct mainnet keys. HTTPS invite/wake calls omit cycle attachments when the fresh installation sets IGNITE_CLOUD_ENGINE=1; mainnet retains its original attachment behavior.

The plugin verifies the signing owner, resolves fresh named service IDs, configures reciprocal links with checked Candid results, reads available owner configuration, and checks the proxy public key. It does not link unreleased club account lifecycle, register/open groups, grant workers or repoint the app. Not all link fields have readbacks.

**Not upload-ready yet:** native runtime installation and encrypted round-trip acceptance cannot execute in this sandbox (write-fault preflight fails). Browser plugin execution, actual controller ownership, complete link readback and real proxy round-trip remain unverified. Successful archive creation/compilation is not runtime acceptance. No upload or live change occurred. Candidate SHA-256: `4a01a2154fcf72f9a80968e9462f8884e6b7a93abfcb0f9b122108243231e0df`.

## Isolated installation request — 17 November 01:46 UTC

Paul requested a separate test installation and confirmation of clubs, encrypted photos and encrypted files. The native-host prerequisite was rerun before any installation: Linux 4.19.0-gvisor reported one recovered fault but writeBit=0 (required: 1). Its probe source SHA-256 is `2cc4fde3d7846f696c53a4bcd418a03abeee0b0191dc1cd4884e42db56d7da6b`. The test stopped before creating or installing canisters; bypassing this prerequisite would invalidate the runtime evidence.

The existing manual GitHub engine-preparation workflow tests only three ordinary service modules and snapshot restoration, not this 18-service archive, its browser setup plugin, or encrypted media. Dispatching it cannot satisfy this request. No native-worker execution or authenticated engine installation was available in this session. A local emulator also cannot authorize calls to the real console proxy merely by substituting its principal: proxy acceptance must be exercised by actual canisters on the approved engine subnet.

Remaining acceptance is: install the exact archive in a compatible isolated environment; verify owner/controller and complete reciprocal service links; create and read a fresh test club with authorized/denied users; upload and decrypt a photo and a document through the real media/PII path; compare recovered bytes; verify an outsider cannot derive keys/read either item; retain the file's extension/MIME; repeat reads after an upgrade. Real-engine proxy and browser-plugin checks remain separate from local test evidence. No existing DEV or PROD identifiers, data, routing or services were changed.

## Compatible native runner execution — 17 November

Ran the existing main-only isolated workflow in `Ignite-Club-HQ/ignite-club_hq-prod` on GitHub's disposable Ubuntu runner: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/43998628899 (source `5f62aec9bde8276e5c823353eb468ceaa58cb982`). Tool preparation, native-host checks and compilation passed. PocketIC started and the three service installations plus club setup reached the event call. The run failed at line 62 with `Club or team admin required`: its club-level coach was attempting a club-wide event. This is correct authorization, not an encryption failure.

The local test now asserts that coach denial explicitly and uses the existing club administrator for club-wide event creation and receipt restoration. No backend permission was changed. Ten host/supervisor checks and script syntax validation pass. The corrected source had not synced to GitHub at the final source read, so a second run was not dispatched against stale bytes. This execution establishes access to a compatible native runner, not full-bundle or encrypted-media acceptance; the archive remains held.

## Corrected runtime result and encrypted-media runner — 17 November 02:00 UTC

The corrected native test passed: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/43999800777, source `7d3e2dd9f79de7ab37316393bdc010f67ded1db7`. Its three actual disposable services exercised club/event setup, coach and outsider refusal, queued reminder/inbox, receipt conflict/deduplication, and permission-preserving snapshot restoration. This is not the full archive installation or encryption acceptance.

Added `test-engine-encrypted-media.yml`: manual main-only Ubuntu 24.04, no live deployment credentials. It rebuilds three modules and refuses any fingerprint mismatch with the candidate; fresh-engine PII is changed only in temporary staging. The local rebuild matches `35c7abe95c8fb3d09abc109fd90eaef5e72fde410e547872d1e89fe45c74158b`. The disposable Motoko proxy fixture compiles and implements the documented length-tagged caller-context rewrite over real emulator VetKD; it is never deployed to a real network.

The prepared runtime checks upload ciphertext, register its hash, derive real SDK keys, recover exact photo/PDF bytes for uploader/member, preserve MIME, refuse outsider upload/key access, preserve keys/bytes through upgrades, and refuse fresh keys after membership removal. Fourteen focused policy/host/supervisor checks and script syntax validation pass. Runtime execution awaits source sync: GitHub returned 404 for the new workflow during this turn, so no encryption pass is claimed. Reports explicitly deny real-console proxy, browser-plugin, full-bundle and upload readiness. No existing DEV/PROD services or data changed.

## Encrypted-media runtime passed — 17 November 02:10 UTC

Confirmed the workflow, runner, proxy fixture and candidate pins synced to `main`, then dispatched the manual credential-free workflow. Run https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/44000708528 passed on source `c8f48112222f3bf76dca123c864ed96d8e220b8e`. Its native host probe passed (writeBit=1), all three rebuilt service hashes matched the candidate, and disposable installations exercised real emulator VetKD with the owned caller-isolating proxy fixture.

Retrieved and inspected `engine-media.json` from artifact `engine-encrypted-media-local-evidence`. The artifact ZIP SHA-256 matched GitHub's digest: `8fc382cd54376fca92a006688d7a599db6c88e735017f2430a9f0471916303db`. The report confirms:

- PNG and PDF ciphertext uploads/downloads, exact-byte SDK decryption for uploader/member and original MIME.
- Outsider upload and decryption-key refusal.
- Public-key, club-membership and encrypted-byte preservation after upgrades.
- Removed members receive no fresh decryption keys; this cannot revoke plaintext or keys already downloaded.

The report explicitly records `realConsoleProxyVerified=false`, `browserPluginVerified=false`, `fullBundleInstalled=false`, `uploadReady=false` and `productionChanged=false`. Four local bundle/encryption policy checks also pass. This clears the isolated three-service encryption check, not browser installation or real-engine authorization. Full 18-service installation, official plugin execution, controller/complete service-link readback and actual engine proxy acceptance remain outstanding. Existing DEV/PROD IDs, data and app routing were untouched; the bundle remains held.
