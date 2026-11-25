# Move Ignite DEV and PROD to OpenCloud

## Recommendation

Use one engine for independent **DEV and PROD**, with **OpenCloud Deploy from Git as the primary update route**. Prove DEV first; retain ICP data only if straightforward, otherwise launch fresh.

**Confirmed: ICP only.** Email/Supabase customers, data, subscriptions and payment records stay untouched. Old ICP data retention is optional, not a release blocker. Prepare the replacement first; delete originals only after handover and exact-target confirmation.

**Future split: fresh DEV on engine 2; PROD stays on engine 1, canisters/keys unchanged.** No encrypted DEV migration; new groups may use other engines.

## What exists already

- Reuse existing engine installation, controller, encryption, grouping and recovery preparation.
- November 17 observations verified eighteen DEV modules and a responding public encryption-key path, **not** complete current setup or real-engine member decryption.
- Prepared two-group DEV layout: six shared parts, including the website, plus thirteen per group — **32 canisters**. Group 2 IDs need independent verification.
- Existing DEV website updates are manual and held. Replace that role with verified OpenCloud Git deployment, not another competing runner.
- PROD promotion targets mainnet and assumes mainnet funding. Replacing IDs alone is unsafe.

## Target arrangement

| Area | DEV | PROD |
|---|---|---|
| Initial engine | Existing OpenCloud engine | Same engine |
| Console organisation | One complete DEV app | One complete PROD app |
| Canisters | DEV-only shared services and independent groups | PROD-only shared services and independent groups |
| Code source | `main` | `prod`, after merging tested code |
| Deployment permissions | DEV-only governor and website publisher | Separate PROD-only governor and website publisher |
| Data | Fresh test data | Straightforward verified old-PROD retention, otherwise fresh; never DEV data |
| Email service | Existing DEV Supabase | Existing PROD Supabase, unchanged |

Keep each environment's website and backend together. Two groups per environment means **64 total canisters**, subject to measured engine capacity. Separate 32-canister environment apps fit the published 50-canister app-record limit; verify the actual operator's limit before provisioning. More groups may require a reviewed console organisation change.

## Phase 1 — Connect OpenCloud Git deployment

1. Obtain owner-authorized current DEV readback: engine/subnet/operator/proxy, every canister, modules, controllers, internal governors and service links. A new controller does not change an internal governor.
2. Use DEV **Deploy from CI**, connect this repository and select `main` if supported. Verify signer/grants, branches, custom builds, existing-ID upgrades, memory preservation and website sync; do not assume undocumented behavior.
3. Reuse Ignite's checks inside this Git entry point. Verify controller/internal-governor authority, retain owner access and protect credentials. Adapt missing controls in the generated workflow; no parallel auto-deployer.
4. Record old/new PROD infrastructure, identity, purchase and push dependencies. Make one bounded metadata/schema/encryption feasibility assessment; no broad customer-content export or Supabase migration.

**Deliverable:** verified Git setup/access and retain-or-fresh recommendation. No controller shortcuts.

## Phase 2 — Finish DEV in one implementation batch

1. Finish the combined DEV app and both independent groups. Preserve working IDs/encryption settings; verify shared/group links, permissions and registries.
2. Complete bounded-wait, cycle-free cross-subnet calls in both directions, caller-isolated proxy VetKeys and direct HTTPS outcalls. Preserve mainnet/email behavior.
3. Adapt Git build/deploy steps to exact engine inventory, subnet, controllers, governors and module fingerprints. Upgrade with memory preserved, then sync website files; start mapped canisters if needed. Never reinstall on failure.
4. Prove a harmless `main` update through OpenCloud Git: both groups update as needed, then the website publishes with engine IDs; test data and decryption survive. Lovable source sync to GitHub triggers it, not Lovable Publish. Disable competing engine auto-upgrades only after acceptance.
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

## Phase 4 — Retain data only if easy; otherwise start fresh

**One bounded review.** Report retention scope, dependencies, changes and effort before transfer work.

- **Keep:** supported complete transfer, rehearsed with correct ownership/roles/links and fresh reads. Existing snapshots may suit unencrypted state, but new IDs need verified remapping.
- **Fresh:** retention requires re-encryption, key relays, extensive reconstruction or uncertain recovery. No broken club shells/orphans; old ciphertext cannot simply use new proxy keys.
- If unclear, recommend fresh and return the scope/effort decision. No automatic deletion or open-ended migration debugging.

After provisioning approval, create independent PROD groups, signers and proxy routing. Verify links/registries/workers; no DEV IDs/data/settings copy. Admission/delivery stay closed until accepted.

Retained data needs exact-transfer approval and identity/permission proof. Fresh PROD imports no old data/alerts; pin sign-in origins, recreate/rejoin clubs and authorize your verified administrator.

Preserve purchases/subscriptions; review entitlement restoration separately. Disposal consent excludes future customer data.

**Deliverable:** independent PROD, easy retention or clean start; no complex migration dependency.

## Phase 5 — Prepare PROD releases and the live handover

1. Prepare verified, closed PROD engine groups with independent PROD credentials and database/public key.
2. Connect PROD to **`prod`** through OpenCloud Git. Preserve promotion/database jobs; require exact-source database success, group upgrades, then website publication. No competing mainnet/engine runner or engine funding assumptions.
3. Verify consistent web/native sign-in: old-account continuity if retaining data, fresh setup otherwise. Clear stale ICP account/club/key caches on deployment change without wiping email data. Pin the intended origin before fresh accounts.
4. Review website/native destinations, routing snapshots, invites/universal links, purchase verification and push queues/workers/devices. Preserve store/package identity, product IDs, prices, subscriptions and email push.
5. Rehearse stale-client handling: old installed apps must not continue writing to a retired service or silently reach DEV. Coordinate the required native release, old-source write closure and website switch; no unproven zero-downtime promise.
6. Obtain your separate live approval. Verify successful PROD database and engine jobs for the exact source commit before traffic/hosting changes. DNS, push scheduling and all-member activation remain separately approved.

**Deliverable:** rehearsed handover and rollback boundary. Retaining originals permits switch-back before new PROD business writes. Afterwards, a rollback must preserve new OpenCloud data or explicitly obtain your approval to discard it; today's permission concerns old PROD data, not future customer data.

## Phase 6 — Operate and scale

Retire old mainnet ICP targets only after handover and exact approval; no Supabase changes. Monitor resources, balance and readable backups.

When separating environments:
- Create engine 2's proxy and complete fresh DEV app/groups/test data; no encrypted snapshot migration.
- Verify DEV, then repoint only `main` Git and DEV sites. Keep `prod`, PROD canisters, proxy/keys, hosting and data unchanged on engine 1.
- Retire exact old DEV targets only; preserve engine 1/proxy and PROD permissions/settings.
- Grow capacity from measurements; add new groups elsewhere, never relocate encrypted clubs.

## Scope of approval and next implementation batch

Approval starts **Git-first DEV setup, consolidated acceptance and a bounded retain-or-fresh assessment**. Controller changes, DEV release, PROD provisioning, transfer/cutover and old-canister deletion retain action approvals. No live reset now; Supabase is excluded.

First result: working OpenCloud Git updates, one acceptance report and a simple data recommendation; then independent PROD on the same engine.