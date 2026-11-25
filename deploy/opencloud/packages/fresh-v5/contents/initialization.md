# Exact first-install requirements — OpenCloud DEV fresh v3

Offline handover only. Nothing is deployed. Existing witness `c6dso-4iaaa-aaac5-aaeqa-cai` stays empty and untouched. No approver signer is needed.

## Remaining ChatGPT actions

1. Authenticate and independently verify all 32 existing canister IDs, empty module before-images, effective controllers, engine/subnet/root key and direct internal-governor/publisher access. Stop on differences; no create/reinstall/controller changes.
2. Read/merge the exact per-target settings in `manifest.json`; preserve the entire existing environment list and omit controllers. Apply 4294967296-byte Wasm limit where supported; use genuine 0 attached cycles.
3. Install the supplied module with its exact constructor below, in install-only mode; verify uncompressed module hash after each acknowledged install. Reconcile uncertain outcomes without blind retries.
4. Execute the 80 exact `postInstallCalls` using the existing governor, save intents/acknowledgments/readbacks, and register both closed router groups plus placements using live CAS revisions.
5. Fill only the explicit null fields in `commissioning-request-template.json` from authenticated complete registry/media readbacks and owner-reviewed logical deployment revision; encode using `candid/identity_access.did`, invoke fresh commissioning once, and verify its receipt/readback. No legacy deletion/recovery provisioning.
6. Install/sync the matched frontend module/plugin using the existing DEV publisher and verify HTTP certification, content hashes, headers, SPA paths and II callbacks.
7. Perform the bounded real signed-in acceptance in `acceptance.md`, including real proxy-derived name/photo vetKeys and outsider/revoked-member denial. Opening base after complete current health/inventory acceptance is a separate authorized action; g2 stays closed. No live success is implied by offline tests.

## Exact configured public identities

- owner: `4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae`
- governor: `vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae`
- frontendPublisher: `jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe`
- operator/API host: `https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net`
- chain-key proxy: `ynolw-eyaaa-aaaaj-qspkq-cai`
- identity authority: `h5lly-yyaaa-aaac5-aadqq-cai`
- expected subnet: `nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae`

## Exact constructors and installed module hashes

Settings are supplied per-target in the manifest; identical service artifacts are deliberately reused for g1/g2.

### shard_router — `htjgq-diaaa-aaac5-aadrq-cai`
- artifact: `artifacts/shard_router.wasm.gz`
- constructor: `(record { governor = principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae" })`
- installed module SHA-256: `5b8993a0de68aa5e87211cb871e88686955c9dda3f4f6387b20f63711ab0d324`
- Candid: `candid/shard_router.did`

### identity_access — `h5lly-yyaaa-aaac5-aadqq-cai`
- artifact: `artifacts/identity_access.wasm.gz`
- constructor: `(record { governor = principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae" })`
- installed module SHA-256: `5772bdcb0b1de988c8e794a393d913da0673ff22cb6b2b743461a3818bfbfd77`
- Candid: `candid/identity_access.did`

### placement_registry — `huiae-oqaaa-aaac5-aadra-cai`
- artifact: `artifacts/placement_registry.wasm.gz`
- constructor: `(record { governor = principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae" })`
- installed module SHA-256: `bbdcb072bc1b59b1f88371ae6f31cf190ac6585811a8a29ded18ea35b2a851c3`
- Candid: `candid/placement_registry.did`

### migration_coordinator — `hgox5-caaaa-aaac5-aadsa-cai`
- artifact: `artifacts/migration_coordinator.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `27307e70a8dc8d1aa93a0df1ada8b4106fe6f403c55cc169dc43944b506cd863`
- Candid: `candid/migration_coordinator.did`

### secret_workload_identity — `hbprj-pyaaa-aaac5-aadsq-cai`
- artifact: `artifacts/secret_workload_identity.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `9ad56e42b4ef294e79c590582c98f73cc688a5a05c6d492d4ec6fceec6096281`
- Candid: `candid/secret_workload_identity.did`

### g1_club_domain — `him2v-zqaaa-aaac5-aadta-cai`
- artifact: `artifacts/club_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `7db1d601001b7c253f473c9afdf5b20b1c922960949541261141863feb1d2648`
- Candid: `candid/club_domain.did`

### g1_events_domain — `gfc63-wyaaa-aaac5-aaduq-cai`
- artifact: `artifacts/events_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `a81d94366fdf798f38f67fc85dece1ecb92d891b005c6b205cf5b193b22ed2c4`
- Candid: `candid/events_domain.did`

### g1_messaging_domain — `gzgek-byaaa-aaac5-aadwq-cai`
- artifact: `artifacts/messaging_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `615ca2d31f2ee26a95e08998ef3e7ef5479b59c2a0ff3af163b91a73c7e282c9`
- Candid: `candid/messaging_domain.did`

### g1_vault_domain — `ee3kc-sqaaa-aaac5-aadza-cai`
- artifact: `artifacts/vault_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `d8f77b442b372a07d402d599ae1a269fc8e370b90351a623d4966d8754bb4b06`
- Candid: `candid/vault_domain.did`

### g1_competition_domain — `gcdyp-3aaaa-aaac5-aadua-cai`
- artifact: `artifacts/competition_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `65689728ac8382ac257db7096d2e8fde3d7d9ede9c87f9ec3d8b53e04d408dda`
- Candid: `candid/competition_domain.did`

### g1_club_points_domain — `hpn4b-uiaaa-aaac5-aadtq-cai`
- artifact: `artifacts/club_points_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `e691ada1198c85da5dfe69a1bba665794a8d5395061d4572cc8aa4ee3387768f`
- Candid: `candid/club_points_domain.did`

### g1_mini_league_domain — `gqfpw-xqaaa-aaac5-aadxa-cai`
- artifact: `artifacts/mini_league_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `803deb64782cc6429056da3c759b217a558f4cefd4ebfe9a6dc5b55f3f505f7f`
- Candid: `candid/mini_league_domain.did`

### g1_media_metadata — `g6hc6-maaaa-aaac5-aadwa-cai`
- artifact: `artifacts/media_metadata.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `904597172e84ee1fe9963c0c01d12b65da017d55a6d8c1db0d06ef9f3edaa9df`
- Candid: `candid/media_metadata.did`

### g1_insights_domain — `gmbvh-aqaaa-aaac5-aadva-cai`
- artifact: `artifacts/insights_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `97ba3f46611a72282df71ce12cfb5c2c42e7f3d121791621723a6b3bebb4854a`
- Candid: `candid/insights_domain.did`

### g1_notification_queue — `gxejc-2iaaa-aaac5-aadxq-cai`
- artifact: `artifacts/notification_queue.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `32df8835ef291b4974a427aa7c7ad30afc7141a3bd0e812562247fe20742e149`
- Candid: `candid/notification_queue.did`

### g1_pii_access_control — `ekzhk-jaaaa-aaac5-aadya-cai`
- artifact: `artifacts/pii_access_control.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `1a2fceb2608c33df1c8df009bde9a3646619548e1dfa535d6c6dd48904806ecc`
- Candid: `candid/pii_access_control.did`

### g1_timer_jobs — `enyb6-eyaaa-aaac5-aadyq-cai`
- artifact: `artifacts/timer_jobs.wasm.gz`
- constructor: `()`
- installed module SHA-256: `f2885fe96cc7bafb4d4eedf8c9f17a79a176b4caf7eb3c798a76a16c0bba8f6e`
- Candid: `candid/timer_jobs.did`

### g1_media_blob_store — `glatt-niaaa-aaac5-aadvq-cai`
- artifact: `artifacts/media_blob_store.wasm.gz`
- constructor: `()`
- installed module SHA-256: `3d8ebe951964e8f71be8c1fc22cfd690d2fdf69be2706244160360d94721cdf9`
- Candid: `candid/media_blob_store.did`

### g2_club_domain — `ed2mw-7iaaa-aaac5-aadzq-cai`
- artifact: `artifacts/club_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `7db1d601001b7c253f473c9afdf5b20b1c922960949541261141863feb1d2648`
- Candid: `candid/club_domain.did`

### g2_events_domain — `ey7qt-fqaaa-aaac5-aad3a-cai`
- artifact: `artifacts/events_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `a81d94366fdf798f38f67fc85dece1ecb92d891b005c6b205cf5b193b22ed2c4`
- Candid: `candid/events_domain.did`

### g2_messaging_domain — `f4s7b-4qaaa-aaac5-aad5a-cai`
- artifact: `artifacts/messaging_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `615ca2d31f2ee26a95e08998ef3e7ef5479b59c2a0ff3af163b91a73c7e282c9`
- Candid: `candid/messaging_domain.did`

### g2_vault_domain — `fhxde-giaaa-aaac5-aad7q-cai`
- artifact: `artifacts/vault_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `d8f77b442b372a07d402d599ae1a269fc8e370b90351a623d4966d8754bb4b06`
- Candid: `candid/vault_domain.did`

### g2_competition_domain — `er43p-tyaaa-aaac5-aad2q-cai`
- artifact: `artifacts/competition_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `65689728ac8382ac257db7096d2e8fde3d7d9ede9c87f9ec3d8b53e04d408dda`
- Candid: `candid/competition_domain.did`

### g2_club_points_domain — `ew553-6aaaa-aaac5-aad2a-cai`
- artifact: `artifacts/club_points_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `e691ada1198c85da5dfe69a1bba665794a8d5395061d4572cc8aa4ee3387768f`
- Candid: `candid/club_points_domain.did`

### g2_mini_league_domain — `f3tzv-riaaa-aaac5-aad5q-cai`
- artifact: `artifacts/mini_league_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `803deb64782cc6429056da3c759b217a558f4cefd4ebfe9a6dc5b55f3f505f7f`
- Candid: `candid/mini_league_domain.did`

### g2_media_metadata — `fvru5-kyaaa-aaac5-aad4q-cai`
- artifact: `artifacts/media_metadata.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `904597172e84ee1fe9963c0c01d12b65da017d55a6d8c1db0d06ef9f3edaa9df`
- Candid: `candid/media_metadata.did`

### g2_insights_domain — `e76wh-iiaaa-aaac5-aad3q-cai`
- artifact: `artifacts/insights_domain.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `97ba3f46611a72282df71ce12cfb5c2c42e7f3d121791621723a6b3bebb4854a`
- Candid: `candid/insights_domain.did`

### g2_notification_queue — `fouiy-qaaaa-aaac5-aad6a-cai`
- artifact: `artifacts/notification_queue.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `32df8835ef291b4974a427aa7c7ad30afc7141a3bd0e812562247fe20742e149`
- Candid: `candid/notification_queue.did`

### g2_pii_access_control — `fjvom-5yaaa-aaac5-aad6q-cai`
- artifact: `artifacts/pii_access_control.wasm.gz`
- constructor: `(principal "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae")`
- installed module SHA-256: `1a2fceb2608c33df1c8df009bde9a3646619548e1dfa535d6c6dd48904806ecc`
- Candid: `candid/pii_access_control.did`

### g2_timer_jobs — `fawfq-lqaaa-aaac5-aad7a-cai`
- artifact: `artifacts/timer_jobs.wasm.gz`
- constructor: `()`
- installed module SHA-256: `f2885fe96cc7bafb4d4eedf8c9f17a79a176b4caf7eb3c798a76a16c0bba8f6e`
- Candid: `candid/timer_jobs.did`

### g2_media_blob_store — `fsqsj-haaaa-aaac5-aad4a-cai`
- artifact: `artifacts/media_blob_store.wasm.gz`
- constructor: `()`
- installed module SHA-256: `3d8ebe951964e8f71be8c1fc22cfd690d2fdf69be2706244160360d94721cdf9`
- Candid: `candid/media_blob_store.did`

### frontend — `h2knm-vaaaa-aaac5-aadqa-cai`
- artifact: `artifacts/frontend.wasm.gz`
- constructor: `()`
- installed module SHA-256: `88fb9e040e1413ac90415ac1082fe11266e494b2a78d7d69ae29703523ee2415`
- Candid: `candid/frontend.did`
