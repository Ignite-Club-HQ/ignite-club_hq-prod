# Move Ignite DEV and PROD to OpenCloud

## Recommendation

Use the existing engine for **DEV and PROD**, with independent canisters, permissions and data. Prove DEV first, then prepare PROD. Retain the live service until destination operation and customer-data preservation are proven.

**Do not start by copying live snapshots or changing live addresses.** First establish what PROD actually contains. If there is existing encrypted ICP data, a full move is blocked until its migration is separately approved and proven. Your email/Supabase customers are not being migrated to ICP as part of this work.

When a second engine becomes worthwhile, leave PROD on this original OpenCloud engine and redeploy DEV fresh on the second one. Keep the existing club-group architecture; place future new groups on additional engines rather than relocating encrypted clubs just to balance capacity.

## What exists already

- Reuse existing engine installation, controller, encryption, grouping and recovery preparation.
- November 17 observations verified eighteen DEV modules and a responding public encryption-key path, **not** complete current setup or real-engine member decryption.
- Prepared two-group DEV layout: six shared parts, including the website, plus thirteen per group — **32 canisters**. Group 2 IDs need independent verification.
- DEV engine website updates are manual and readiness-held, not whole-app automatic deployment.
- PROD promotion targets mainnet and assumes mainnet funding. Replacing IDs alone is unsafe.

## Target arrangement

| Area | DEV | PROD |
|---|---|---|
| Initial engine | Existing OpenCloud engine | Same engine |
| Console organisation | One complete DEV app | One complete PROD app |
| Canisters | DEV-only shared services and independent groups | PROD-only shared services and independent groups |
| Code source | `main` | `prod`, after merging tested code |
| Deployment permissions | DEV-only governor and website publisher | Separate PROD-only governor and website publisher |
| Data | Fresh test data | Existing PROD data retained or explicitly migrated; never DEV data |
| Email service | Existing DEV Supabase | Existing PROD Supabase, unchanged |

Keep each environment's website and backend together. Two groups per environment means **64 total canisters**, subject to measured engine capacity. Separate 32-canister environment apps fit the published 50-canister app-record limit; verify the actual operator's limit before provisioning. More groups may require a reviewed console organisation change.

## Phase 1 — Resolve access and take a current inventory

1. Obtain owner-authorized current DEV readback: engine/subnet/operator/proxy, every canister, modules, controllers, internal governors and service links. A new controller does not change an internal governor.
2. Inspect **Deploy from CI**: signing identity, branch restrictions, custom builds, existing-ID upgrades, memory preservation and website-file uploads. Do not enable unverified PROD deployment.
3. Use the existing GitHub pipeline if OpenCloud CI lacks those guarantees. Grant permissions through an owner-supported route, retaining owner control; no secrets/session exports in chat and no reinstall to fix access.
4. Separately authorize read-only PROD inventory: groups, accounts/roles, encrypted names/files, history/scores, devices and pending alerts/timers. Record original key authorities and sign-in origins. Check all data, not just club counts; reports contain no customer content or credentials.

**Deliverable:** current setup report, verified deployment route and PROD data-migration decision. Missing access remains a named blocker.

## Phase 2 — Finish DEV in one implementation batch

1. Finish the combined DEV app and both independent groups. Preserve working IDs/encryption settings; verify shared/group links, permissions and registries.
2. Complete bounded-wait, cycle-free cross-subnet calls in both directions, caller-isolated proxy VetKeys and direct HTTPS outcalls. Preserve mainnet/email behavior.
3. Adapt existing tooling to exact engine inventories, subnet, controllers, governors and module fingerprints. Upgrade with memory preserved, then sync website files; start mapped canisters if needed. No replacement/reinstall on sync failure.
4. After acceptance, `main` source updates upgrade the whole DEV app, then publish its website with engine addresses. Lovable-to-GitHub source sync triggers this; Lovable Publish is not an OpenCloud deployment trigger.
5. Reuse durable receipts; uncertain mutations stop for authenticated readback, never blind replay.

**Deliverable:** verified DEV automatic updates. Enable/repoint DEV only after your separate release approval; PROD stays untouched.

## Phase 3 — Prove DEV and shared-engine operations

Run one consolidated acceptance batch against real authorized test accounts in both groups:

- Browser and Android/iOS sign-in/resume preserve identity and memberships.
- Clubs/teams/events, chats/attachments, real names, history and match statistics work in both groups.
- Other authorized members freshly decrypt gallery/chat/Vault files with byte/MIME/extension equality, cleared key caches and after an upgrade.
- Outsiders/removed members are denied without breaking their unrelated club.
- New-game auto-subs reset, clocks resume correctly and locked-phone sub/chat/event alerts deliver correct content, not merely queue.
- Disposable encrypted backup/restore proves fresh readable recovery under the original key authority, not just ciphertext hashes.
- Measure startup/operation latency and aggregate resource use. Destructive/high-load tests run away from the intended shared PROD engine.

Set PROD execution reservations and DEV memory caps from measurements; they do not eliminate shared-resource risks. Verify rental/egress terms, top-ups, proxy funding, exhaustion/retention behavior, warnings and recovery. Do not infer club capacity or prices from disk specifications.

**Deliverable:** a single pass/fail report tied to the exact source and real engine configuration, including outstanding physical-phone checks.

## Phase 4 — Choose the PROD data path

### A. No customer ICP data requires preservation

After inventory and your approval, provision independent equivalent PROD groups/permissions. Recreate only reviewed configuration; preserve any existing identity commitments/registrations. Never copy DEV data. Supabase records stay where they are.

This is the simplest path **only if the inventory proves it applies**.

### B. Existing customer ICP data must move

Keep populated clubs on original authorities pending a separate migration rehearsal. New IDs require verified service/trusted-caller/routing/ownership/worker/identity remapping. Snapshots alone prove neither those links nor encrypted access.

OpenCloud recommends decrypt/re-encrypt, but Ignite does this in authorized clients; its canisters have no general decrypt path or stored master key. **Bulk canister-side conversion is not supported**, and the existing encrypted-media stay-put policy prohibits executing it.

Design authorized conversion for every encrypted field/file format, interruption recovery, permissions, destination readback and rollback; prove it on disposable data. Retaining mainnet key authorities would require separate approval and remain an interim hybrid, not a full OpenCloud move.

**Gate:** your separate decision on the proven approach and stay-put policy precedes any live conversion. If access cannot be preserved, populated clubs do not move. This plan is not migration authorization.

## Phase 5 — Prepare PROD releases and the live handover

1. Prepare verified, closed PROD engine groups with independent PROD credentials and database/public key.
2. Extend existing `main` → `prod` code-only promotion, keeping database promotion intact. Engine execution excludes mainnet funding/creation assumptions; retained mainnet tooling stays valid. Verify every changed group service.
3. Prove existing Internet Identity origin/principal continuity through supported alternative origins, or separately design authorized account mapping. A new frontend ID does not automatically preserve accounts.
4. Review website/native destinations, routing snapshots, invites/universal links, purchase verification and push queues/workers/devices. Preserve store/package identity, product IDs, prices, subscriptions and email push.
5. Rehearse stale-client handling: no competing writable copies. Coordinate required native releases and write pauses explicitly; no unproven zero-downtime promise.
6. Obtain your separate live approval. Verify successful PROD database and engine jobs for the exact source commit before traffic/hosting changes. DNS, push scheduling and all-member activation remain separately approved.

**Deliverable:** rehearsed handover and rollback boundary. Before destination business writes, routing can return to originals. Afterwards, routing reversal alone risks divergence/data loss: stop writes and use proven recovery.

## Phase 6 — Operate and scale

Retain mainnet services/keys until migration, decryption and recovery pass and you approve retirement. Monitor canister/engine memory, heavy-call instructions, latency, balance and backups.

Increase node capacity based on measurements; add new groups on other engines, keeping traffic local. Later redeploy DEV fresh; do not move PROD or rotate keys to split environments.

## Scope of approval and next implementation batch

Approval starts **Phases 1–3 preparation and DEV implementation**, reusing the existing tooling. Owner-authorized reads/controller actions, any DEV release, PROD provisioning, existing-data conversion, live cutover and retirement retain their separate approval requirements. No live operation is implied by this document.

First result: working DEV updates, consolidated acceptance and a PROD inventory decision — not another bundle or premature live switch.