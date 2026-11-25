# Grouped OpenCloud DEV: offline preparation

## Updated direction — 25 November 2026

The approved plan in `.lovable/plan/move-ignite-dev-and-prod-to-opencloud-2026-11-25.md`
supersedes the earlier mainnet-only PROD destination below. Prefer OpenCloud's
Git deployment, independent DEV/PROD on the initial engine, and fresh DEV on a
second engine later without moving PROD or its key authority. Old ICP retention
is optional and bounded; Supabase and paid subscriptions remain untouched.

The current console access check still reaches sign-in. No authorized OpenCloud
transport or generated Git setup is available here; controller/branch/upgrade
behavior cannot yet be verified. Thirty existing grouped-preparation/controller
tests passed, but this is local preparation evidence, not live acceptance.
No workflows, controllers, data, hosting or deployment destinations were changed.

## Scope and layout

This prepares the agreed two-group DEV alternative, not a deployment or switch.
The existing grouped mainnet DEV remains the release-testing environment until
OpenCloud passes actual grouped acceptance. PROD stays on mainnet, unchanged.

Keep the existing nineteen-canister app together and extend that same app:

| Placement | Parts | Count |
| --- | --- | ---: |
| Shared | frontend, identity_access, shard_router, placement_registry, migration_coordinator, secret_workload_identity | 6 |
| Group 1 | club_domain, events_domain, messaging_domain, vault_domain, competition_domain, club_points_domain, mini_league_domain, media_metadata, insights_domain, notification_queue, pii_access_control, timer_jobs, media_blob_store | 13 |
| Group 2 | Same thirteen roles, with new independent canister IDs | 13 |
| Total | One combined app, two groups | **32** |

The existing app provides nineteen historical ID references; thirteen Group 2
IDs are recorded from Paul's 18 November 05:48 console screenshot in
`docs/dev-engine-group2-owner-inventory.json`, explicitly not independently verified.
The final display remains one combined app with one frontend. Group 2 installation
and status are not independently certified by this work. Capacity for 32 running parts on the
current Nano engine is unmeasured and must be checked before extending it.

## What is ready now

`scripts/engine-grouped-preparation.mjs` reuses the current mainnet shared/group
service inventories. It generates an inactive draft and assesses bounded local
readback input. It does not load a signing key, create an agent, call a canister,
change hosting or connect to a workflow. Historical installed hashes are not
current reviewed upgrade artifacts; those fields remain unset in the draft.

```text
node scripts/engine-grouped-preparation.mjs draft > /tmp/grouped-engine-plan.json
node scripts/engine-grouped-preparation.mjs updates > /tmp/grouped-engine-updates.json
node scripts/engine-grouped-preparation.mjs connections > /tmp/grouped-engine-connections.json
node --test scripts/engine-grouped-preparation.test.mjs
node scripts/engine-grouped-preparation.mjs check PLAN.json CAPTURE.json NOW_MS MAX_AGE_MS
```

The check returns a nonzero exit status when prerequisites are missing. A complete
input report means only that supplied observations meet these checks; all
deployment, promotion and activation permissions remain false. Inputs are local
JSON files, at most 256 KiB each. Freshness is explicitly supplied, not an invented
production default. Never include private keys, delegation tokens or personal
data in captures. Receipt values are locators, not proof.

## Inactive DEV update review — 18 November

The `updates` command emits review-only JSON for all 32 targets. It pins `main`,
the existing DEV Supabase URL, historical shared/Group 1 IDs and owner-reported
Group 2 IDs. It preserves one frontend and separate group photo stores. This is
not an environment file, executable workflow or live deployment configuration;
no hosting or update workflow consumes it. `enabled` and every execution grant
remain false. Reviewed artifact hashes and registry revision remain unset.

The candidate lists owner-plus-DEV-governor controller requirements (publishing
key on frontend only), separately required internal governors, upgrade-only state
preservation and zero-cycle engine handling. Proposed console metadata merges
`__META_PROJECT=ignite_dev` on all targets and marks only the existing frontend
as main; it is not applied and must preserve other settings. The 32-settings limit
still requires authorized inspection before applying metadata, not replacement
of encryption/governor settings or another combined import.

Service wiring still requires authorized current configuration reads and reviewed
reciprocal links. IDs alone neither register the two groups nor prove installation.
After access is resolved, verify the complete inventory, original key identity,
reviewed modules, service links and closed registry, then exercise signed-in name,
photo, document and access-denial flows before any DEV cutover. PROD is untouched.

## Controller permission is only the first blocker

### Exact connection review and switch-back preparation — 18 November

The `connections` command expands the existing closed browser recipe twice,
resolving each group's destinations only within that group, except the queue's
explicit shared identity connection. Gallery, Vault and club links are reciprocal;
each group retains its own blob store and PII authority. Source Candid interfaces
are checked for the listed methods and fingerprinted with the recipe and inventory.
This proves local method presence only, not deployed argument compatibility or
owner authorization. It emits no calls, executable environment file or workflow.

All 32 parts have review coverage. The group review includes consensus configuration
readers and permission requirements, including local club-role permission sources
for metadata/insights. Shared identity, router, placement, coordinator and workload
bindings remain explicit unresolved reviews, not invented setter instructions.
Current values and original key commitments are unset. Read the entire authorized
configuration, preserve correct values, and hold differing values for review;
do not blindly replay timer initialization or singleton-overwrite registries.

Before a separately approved cutover, record the actual mainnet DEV website and
update destinations, source revision and routing revision; retain all existing
canisters and key authorities. Keep any credential-bearing before-images outside
reports and commits. Check identity origins: switching websites can produce a
different sign-in principal, and no account-linking or role grant is implicit.

If acceptance fails, stop and retain unknown-write intents. A switch-back restores
only separately reviewed DEV website/update routing before-images, then verifies
mainnet sign-in, existing clubs and fresh media. It does not undo engine writes,
copy engine records into mainnet, rotate keys, reinstall canisters or touch PROD.
Neither this checklist nor its hash is a cutover/recovery authorization.

OpenCloud's console explicitly reported that bundles cannot add controllers;
do not try another package to grant GitHub permission. Support/owner access must
retain the OpenCloud owner and add the DEV governor on backend parts, plus the
publishing key on the frontend (the DEV governor also remains on the frontend).

**Adding a management controller does not change a service's internal governor.**
The successful v2 app was initialized under the owner identity. After support
adds GitHub's keys, separately read each service's internal governor and full
configuration with authorized access. Existing DEV grant/upgrade tools still
pin mainnet IDs and cannot just be pointed at this app. The current upgrade policy
also expects sole-governor control; engine updates must use a separate reviewed
owner-plus-governor controller policy without weakening mainnet safeguards.

Do not reinstall existing parts or replace their encryption settings to resolve
this. Determine which services support an owner-authorized handover; where an
upgrade is needed, review an in-place state-preserving path separately. This
preparation ships neither handover calls nor a live verification transport.

## Ordered installation and connection plan (not executed)

1. Obtain owner-authorized current readback of the existing 19 parts: controllers,
   subnet, modules, internal governors, all service links and original PII key
   identity. Resolve the internal-governor handover before GitHub tools run.
2. Review engine-compatible artifacts from one source revision. Shared roles
   occur once; every group receives the same reviewed program for each role.
   Preserve engine-specific build/init settings; ordinary mainnet Wasm must not
   be assumed engine-compatible merely because the source commit matches.
3. Review a same-app extension with exactly 13 new blank Group 2 parts. Use the
   existing closed installer/journal protocols, zero attached cycles and no
   paid mainnet creation route. Persist intent/readback; unknown outcomes hold,
   never retry installs or creates blindly. No executable extension is shipped.
4. Configure reciprocal group-owned links: club roles to events/chat/competition/
   leagues/rewards/insights; club to PII; metadata to its own blob store and club;
   gallery club/metadata/queue links; Vault ACL authority; queue audiences and
   timers. Bind shared identity/router/placement/coordinator/workload services
   explicitly to both groups. Reuse exact existing configuration readers rather
   than inventing setter signatures.
5. Read back the complete 32-part inventory and closed two-group router/placement
   registry at one exact decimal-text revision. Each group has its own blob
   store and PII authority. No registration/opening is authorized by this plan.
6. Run the acceptance matrix below on explicitly authorized fresh DEV test clubs.
   Only then separately review DEV website/upgrade routing and owner cutover.
   Old mainnet DEV clubs remain where they are; nothing copies to OpenCloud.

## Signed-in acceptance matrix

The automated tests verify checklist accounting and failure handling, not these
live scenarios. Capture exact plan hash, observation time, pass/fail and a
content-free evidence locator for each of the eighteen scenarios exported as
`GROUPED_ENGINE_SCENARIOS`. Each requires actual independently checked evidence:

- Two fresh clubs placed in distinct groups; one user in both, one in only each,
  an outsider and staff. Club/team/chat roles must stay at their own authority.
- **Each group:** fresh gallery upload and another authorized member's fresh
  decryption; chat document byte equality plus original extension/MIME; Vault
  staff access and ordinary-member refusal. Clear relevant test-device key
  caches to prove fresh derivation; visible cached names/photos are insufficient.
- Outsider name/photo/document denials. After role removal, fresh authorized
  reads/key requests deny while the user's unrelated club still works. Do not
  promise erasure of plaintext or keys previously obtained legitimately.
- Shared identity/app-admin and invites; notifications scoped to both queues
  with queued versus actual delivered counts distinguished; authorized timers.
- Unknown write outcomes stay held without replay. A code-only upgrade keeps
  both groups' accounts/roles/media bytes and original decryption identity.
- Actual proxy vetKD with bounded cycle-free calls, ordinary direct HTTP
  outcalls, browser/mobile identity continuity and physical-phone acceptance.
- Real storage/rental readings and a full readable encrypted backup/restore
  rehearsal under the original key authority, not a ciphertext-only roundtrip.

Fixtures never count as engine captures. Even a complete caller-supplied record
set never grants release authority. Existing `engineAcceptance.ts`, closed
installation and operational/recovery rehearsals remain the underlying wider
checks; this adds the explicit two-group coverage, not another activation switch.

## Media storage and promotion

Groups isolate stores and quota/authorization, **not physical disks** when both
share one engine. The observed 100 GB SSD is a machine specification, not proven
usable stable memory per canister or 100 GB per group. Measure aggregate encrypted
bytes (gallery plus chat/Vault documents), upload overhead, metadata, backup space,
growth and engine limits. Obtain enlargement behavior/rental terms before deciding
how many clubs the engine can admit; do not invent a storage quota or price.

Group 2's PII caller identity yields its own proxy-derived keys. Never change Group
1's proxy/PII identity or move its encrypted clubs simply to balance capacity.
For now place only fresh test clubs into the new group. Mainnet encrypted clubs
stay on mainnet. Engine rental exhaustion/deletion risk requires independently
tested monitoring and readable recovery before real users are placed there.

Promotion is source/code-only, with independently built/reviewed platform-specific
artifacts where necessary. PROD retains its own IDs, database, routing revision,
proxy/keys, controllers and data; no DEV records, journals or settings are copied.
If a change depends on engine behavior, grouped OpenCloud evidence alone does not
prove mainnet behavior: retain a mainnet rehearsal for that path while PROD uses
mainnet. No GitHub workflow, hosting setting or live canister was changed here.

## Published capacity and price research (18 November 2026, opencloud.org)

Market-observed figures from OpenCloud's public pricing and node-class pages;
node providers set real prices in the console wizard, so treat these as budget
ranges, not quotes. Engine canisters hold zero cycles on a free cost schedule,
so the monthly node fee plus metered egress bandwidth is the whole running cost.

Per-node class floor (vCPU / RAM / NVMe) and observed USD per node per month:

| Class | Spec floor | US | EU hyperscaler | Hetzner EU |
| --- | --- | ---: | ---: | ---: |
| nano | 2 / 8 GiB / 100 GB | $40–41 | $41–45 | not in region |
| std | 8 / 32 GiB / 500 GB | not in region | $350 | $95–105 |
| perf | 16 / 64 GiB / 1 TB | $588–613 | $625–675 | $185–195 |
| hperf | 32 / 128 GiB / 2 TB | $1,200 | $1,275–1,325 | $375 |
| dense | 64 / 256 GiB / 4 TB | $2,275 | not in region | not in region |

Consequences for Ignite media:

- The current DEV engine (4× nano) is roughly $160–180/month plus egress, and
  its 100 GB per node is the ceiling for **all** parts together — both groups'
  blob stores, metadata and every other service share it. Adding Group 2 on the
  same engine adds isolation, not storage.
- Storage growth on an engine means swapping node class (OpenCloud supports
  class swaps without interrupting hosted apps), not adding groups. A 4-node
  std engine (500 GB/node) is roughly $380–420/month on Hetzner-class nodes;
  perf (1 TB/node) roughly $740–780/month. Mainnet groups spread storage
  across subnets instead, which engines cannot do.
- Media egress is metered separately per node operator: ~$0.09/GB at
  hyperscaler rates (100 GB/month included) versus 20 TB/month bundled on
  Hetzner-class nodes. A photo-heavy club app should prefer bundled-egress
  nodes; node choice matters more than class for bandwidth cost.
- Worked examples published by OpenCloud: 4× nano hobby engine $92–220/month;
  7× std production engine $630–2,492/month.

These figures do not change the recommendation: grouped mainnet DEV remains the
release-testing environment; PROD stays on mainnet. Usable stable-storage
capacity per canister on the engine is still unmeasured and must be rehearsed
before any real club is placed there.