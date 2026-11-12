# Future Cloud Engine switch — offline preparation

## Available now

Placement Settings → **Add future engine** creates a disabled draft in the form without an engine account, address or canister IDs. It connects nothing and changes no country pins. Saving uses the existing administrator action; no settings are written automatically.

**Download preparation** exports that draft, the required service inventory and outstanding commissioning tasks. It excludes country pins and is not an importable live routing configuration, release approval or verified deployment evidence.

Mainnet stays active. Existing clubs and encrypted media retain their original deployments. Do not pin countries to inactive engines: the current fallback is Supabase, not mainnet.

## Items 1, 3 and 4 prepared without an engine — 12 November

- **Installation/upgrades:** the existing closed installer now accepts explicit mainnet or engine destinations. Mainnet requires a reviewed initial/minimum cycle amount; engines never receive cycles. Both use the same complete group inventory, dedicated photo store, journal-before-mutation protocol, foreign-module refusal and checked/unregistered stopping point. The upgrade protocol pins the complete source/destination inventory, rechecks completed work, journals each upgrade before mutation and refuses unresolved replies without replay; it has no create/reinstall/register/open operations. No default live transport was added, no services were installed or upgraded, and existing persisted engine install bindings require a fresh review under the expanded binding format. Mainnet deployment scripts are unchanged.
- **New-club switch:** `rehearseEngineNewClubSwitch` exercises off/on decisions and exact deployment revision binding without writing any assignments. Existing clubs retain their original groups. Even a successful rehearsal carries no activation authority; the ordinary planner and `CLOUD_ENGINE_RELEASED` remain held. This is not a released authority-side admission switch.
- **Backups and funding alerts:** `scripts/engine-operational-preparation.mjs` provides bounded AES-256-GCM encrypted local exports, externally supplied keys, exact inventory/module/revision binding, exclusive non-overwriting files and full decode/content comparison drills. It also provides one-pass, content-free warning recording with explicit thresholds, stale/unreadable-reading refusal, rental runway for engines and per-service cycles for mainnet. It adds no scheduler, delivery channel, payment, live snapshots or restore operations. Backup keys are never stored with the archive.

Run the focused drills with:

```sh
node --test scripts/engine-operational-preparation.test.mjs
# from frontend/
bunx vitest run --config vitest.legacy.config.mjs src/live/engineIndependent.test.ts src/live/engineSwitchPreparation.test.ts src/live/enginePreparation.test.ts
```

The local backup reader only accepts supplied local exports (16 MiB total, at most 64 services); it is not connected to mainnet snapshots. Full live backups and permission-preserving recovery still use the existing separately fenced recovery procedures. Successful local decoding never claims encrypted photo-key recovery or independent real-engine evidence.

**Still deferred:** item 2 (proxy-backed engine encryption), actual engine/operator access, engine-compatible calls in both directions, real mixed-deployment admission/membership and group push coverage, rental-provider readings/delivery wiring, and a real-engine install/backup/restore acceptance. No engine connection, rental, funding, settings save, country pin, existing-club move or PROD action occurs in these rehearsals.

## Later handover checklist

The existing **Download preparation** now includes nine ordered, pending stages with prerequisites and explicit real-engine requirements. It is a checklist, not an activation control; completing it does not grant release authority.

1. Compare measured mainnet costs with quoted engine rental, capacity, proxy charges and backup costs. No invented price or automatic switching threshold is configured.
2. Obtain console/API details, subnet, deployment access and official encryption proxy; fill in the existing draft.
3. Complete the engine-specific deployment connection and engine-compatible modules. Mainnet paid-create/top-up workflows are not engine installers.
4. Install complete fresh groups and shared authority links; verify bounded/cycle-free cross-subnet calls in both directions and uncertain-write reconciliation.
5. Implement official proxy-backed encryption and prove new-file decryption. Existing encrypted clubs stay put.
6. Complete authority-side new-club placement, mixed mainnet/engine memberships and push coverage for each opened group. Country selection alone cannot do this.
7. Verify real browser/phone sign-in, chats, uploads, permissions, timers, notifications, rental alerts and readable backup/restore.
8. Obtain Paul's opening approval and release the verified implementation before selecting an engine for new clubs.

## Preparation limits

Activation stays disabled. Existing offline installer/acceptance protocols and these drafts reduce later setup work but do not prove real-engine compatibility. A future switch still requires deployment, encryption/routing code changes and real-engine checks—not just flipping a setting. No engine is connected or rented by this work.

## Further offline preparation — calls, full local rebuild and checklist

- `scripts/engine-call-preparation.mjs` rehearses destination-, revision-, caller-, operation- and argument-bound calls. It rejects cycle attachments and waits outside 1–300 seconds; journals/readbacks intent under an exclusive writer before dispatch; holds lost, timed-out or foreign replies; and settles only exact outcome readback, never resending uncertain writes. Local deadlines do **not** implement IC bounded-wait. Actual Motoko/Rust call sites remain unchanged and need separate bounded-wait implementation and real cross-subnet acceptance.
- `scripts/engine-group-restore-drill.mjs` decrypts the complete supplied local inventory, decodes and compares every service against a before-image, then reconstructs fresh disposable state and checks full readback. Regressions cover all 17 currently required engine services, retained permissions/denials/pending operations/history/zero/null, missing inventory and wrong keys. Timing measures local decrypt/decode/rebuild only—not recovery time for real canisters. This uses synthetic local exports, not a live TEST backup or production data; it does not recover encryption keys or certify deployed ledger formats.
- The exported checklist orders economic review, destination, closed install, calls, encryption, isolated club, operations, owner review and new-club admission. All stages start pending. Encryption remains deferred; no admission, settings or existing assignments change.

```sh
node --test scripts/engine-further-preparation.test.mjs scripts/engine-operational-preparation.test.mjs scripts/group-removal-recovery.test.mjs
```

**Still unverified:** actual TEST-group round trips or full canister restore (no accepted live recovery transport used), real-engine call semantics/encryption/rental readings, phone acceptance and live alert delivery. Offline receipts and local test success never authorize connection, opening or resume.