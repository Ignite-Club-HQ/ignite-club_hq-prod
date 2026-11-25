# Move Ignite DEV and PROD to OpenCloud

## Recommendation

Use one engine for independent **DEV and PROD**. Prove DEV, then launch **fresh, empty PROD on OpenCloud**. Old ICP data is disposable: no snapshot migration or re-encryption.

**Confirmed: ICP-only reset.** Email/Supabase customers, data, store subscriptions and payment records stay untouched. Build the replacement first; delete originals only after verified handover and exact-target confirmation.

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
| Data | Fresh test data | Fresh empty application data; no old PROD or DEV data copied |
| Email service | Existing DEV Supabase | Existing PROD Supabase, unchanged |

Keep each environment's website and backend together. Two groups per environment means **64 total canisters**, subject to measured engine capacity. Separate 32-canister environment apps fit the published 50-canister app-record limit; verify the actual operator's limit before provisioning. More groups may require a reviewed console organisation change.

## Phase 1 — Resolve access and take a current inventory

1. Obtain owner-authorized current DEV readback: engine/subnet/operator/proxy, every canister, modules, controllers, internal governors and service links. A new controller does not change an internal governor.
2. Inspect **Deploy from CI**: signing identity, branch restrictions, custom builds, existing-ID upgrades, memory preservation and website-file uploads. Do not enable unverified PROD deployment.
3. Use the existing GitHub pipeline if OpenCloud CI lacks those guarantees. Grant permissions through an owner-supported route, retaining owner control; no secrets/session exports in chat and no reinstall to fix access.
4. Record the exact old/new PROD infrastructure, hosting, sign-in origins, store/payment dependencies and push bindings. This is a bounded cutover inventory, not a customer-data migration audit. Confirm the ICP-only reset boundary; do not read/export old customer content or assume permission to clear Supabase.

**Deliverable:** current setup report, verified deployment route and exact fresh-PROD reset boundary. Missing access remains a named blocker.

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

## Phase 4 — Build fresh PROD on the same engine

1. After DEV acceptance and provisioning approval, create the complete independent PROD app/groups, PROD governors/publishers and verified proxy route. Never reuse DEV IDs.
2. Install reviewed engine code into blank canisters. Import no old clubs, memberships, names, history, scores, messages, files or pending alerts; build no re-encryption tooling.
3. Configure all PROD links, registries, routing and workers. Recreate reviewed operational settings only; admission/delivery remain closed until accepted.
4. Pin consistent web/native Internet Identity origins before fresh accounts. Users recreate/rejoin clubs; bootstrap your verified administrator through authorized setup, never first-user grants.
5. Preserve store subscriptions and purchase-verification records. If paid-account associations need restoration, review that entitlement-only path separately; no old business-data copy or product-ID changes.

**Deliverable:** verified empty PROD, ready for approved launch. Fresh encrypted data uses new PROD keys. Old mainnet services remain until handover, not as permanent hybrid dependencies.

## Phase 5 — Prepare PROD releases and the live handover

1. Prepare verified, closed PROD engine groups with independent PROD credentials and database/public key.
2. Extend existing `main` → `prod` code-only promotion, keeping database promotion intact. Engine execution excludes mainnet funding/creation assumptions; retained mainnet tooling stays valid. Verify every changed group service.
3. Verify consistent fresh-account Internet Identity sign-in across browser/native destinations. If existing principals can be retained through a supported origin arrangement, do so; do not require old-account migration. Explicitly clear stale ICP account/club/key caches when the deployment changes, without wiping email data.
4. Review website/native destinations, routing snapshots, invites/universal links, purchase verification and push queues/workers/devices. Preserve store/package identity, product IDs, prices, subscriptions and email push.
5. Rehearse stale-client handling: old installed apps must not continue writing to a retired service or silently reach DEV. Coordinate the required native release, old-source write closure and website switch; no unproven zero-downtime promise.
6. Obtain your separate live approval. Verify successful PROD database and engine jobs for the exact source commit before traffic/hosting changes. DNS, push scheduling and all-member activation remain separately approved.

**Deliverable:** rehearsed handover and rollback boundary. Retaining originals permits switch-back before new PROD business writes. Afterwards, a rollback must preserve new OpenCloud data or explicitly obtain your approval to discard it; today's permission concerns old PROD data, not future customer data.

## Phase 6 — Operate and scale

After verified handover, use a separately reviewed exact old-ICP inventory to retire/delete originals with your confirmation. Never bulk-delete by label or touch Supabase. Monitor new PROD memory, instructions, latency, balance and readable backups; preserve its proxy/key identity for future data.

Increase node capacity based on measurements; add new groups on other engines, keeping traffic local. Later redeploy DEV fresh; do not move PROD or rotate keys to split environments.

## Scope of approval and next implementation batch

Approval starts **Phases 1–3 preparation and DEV implementation** and prepares fresh PROD. Controller changes, DEV release, PROD provisioning, cutover and exact old-canister deletion retain separate action approvals. No live reset runs now; Supabase is explicitly excluded.

First result: working DEV updates and consolidated acceptance, followed by independent fresh PROD — no old-data migration project.