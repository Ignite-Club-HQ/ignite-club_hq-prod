# New-club automatic setup audit

**Verdict: not yet an unconditional “yes”.** The current DEV code corrects the broken duplicate Club chat and the missing team rows for club administrators. However, this audit found remaining automatic-setup, recovery and staff-chat authorization issues. Passing the existing tests does not cover all of those issues.

Audited 23 November 2026 against `d1af3d158` on the current working branch. Scope: new ICP club placement, creation/setup, club-owned team creation, automatic chats, Messages visibility/opening, access, assistant instructions and phone-source parity. This was an audit, not a repair or release: no application changes, production records, approval changes, workflow dispatches, merges or deployments.

## What should happen next time

| Step | Current implementation | Assessment |
|---|---|---|
| Choose destination | Reserve placement, refresh the revision-bound session and create only at the assigned group; refuse failed placement without falling back. | Focused source tests pass. Fresh live configuration was not reverified in this audit. |
| Create club | Save club and creator's club-admin role; launch canonical club-conversation provisioning. | Automatic, but chat provisioning is best-effort rather than part of the confirmed club result. |
| Complete setup | App follows creation with home country, general settings, optional logo and standard staff groups. | Follow-up failures can be logged while creation still reports success. |
| Create club-owned team | Save team and launch its canonical conversation with team members and club admins. | Automatic provisioning attempt; success of team creation does not prove chat creation succeeded. |
| Display team chats | Admins see every active team in their club; ordinary members see their assigned teams. | Recent DEV fix passes regression tests. |
| Display club chat | Canonical club conversation appears as the club row, not an extra private group. | Recent DEV fix passes regressions, including restored-cache filtering; genuine same-name private groups remain separate. |
| Open a missing canonical chat | Read first; repair only confirmed absence, then read again. | Recovery logic passes tests; it will not turn an access denial into a replacement room. |
| Staff groups | App creates Coaches, Team Admins and Club Committee using stable standard identities. | Uniqueness/retry checks pass, but permission and membership-sync problems remain below. |
| ChatGPT-created club | Assistant contract requires placement, assigned service, country/settings and scoped verification. | Canonical chat provisioning is attempted by the service. Standard staff groups are completed when an administrator opens Messages in Ignite, not guaranteed by a bare assistant create call. Use routing target `mainnet`, not `ic` or `prod`. |
| Installed phone | Same application paths, with native startup safeguards. | Source tests pass; installed bundle version and real-phone acceptance were not verified. |

Team chats remain free. Club-wide chat and staff-role groups retain their Club Pro restriction. An intentionally locked club/staff chat is not a creation failure. This audit checked the relevant presentation/access tests, not a full live purchase/entitlement matrix.

## Remaining findings

### 1. Priority: standard staff-chat creation does not require a club-admin role

**Confirmed in source, not exploited against live accounts.** `ensure_default_club_chat` verifies current club membership but not an authoritative club-admin role before creating an unbound standard chat. It accepts caller-supplied audience roles, including `owner`.

A regular club member could therefore claim an uncreated standard Coaches/Team Admins/Committee identity as owner. Existing standard bindings do not accept injected owner rows on reuse, which is an important protection, but it does not close initial creation.

Evidence: `backend/messaging_domain/src/main.mo:2598–2663`; `frontend/src/live/defaultClubChats.ts:63–68`. The existing disposable test denies a stranger, not a verified ordinary member, and mostly acts as governor.

**Required follow-up:** use current club-admin authorization for standard-chat creation/repair and test ordinary-member refusal, administrator success and stable reuse. Do not broaden personal/private-group management to solve it.

### 2. A successful club/team result is not a confirmed chat result

**Confirmed in source.** Canonical provisioning skips missing messaging configuration, ignores remote `Err` results and catches transport rejection. The bulk “ensured” counter increments after attempts even if they failed. Thus `ensure_club_conversations` can return a successful count without that many acknowledged conversations.

Opening a thread has a correct one-attempt missing-chat repair, but its bulk provisioning result is not reliable evidence of completion. Latest-message preview failures are also omitted, so an empty preview cannot prove a working empty chat.

Evidence: `backend/club_domain/src/main.mo:7741–7783`; `frontend/src/features/messaging/thread/icpThreadRead.ts:2–17`; `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:50–69`.

**Required follow-up:** distinguish acknowledged chats from attempted provisioning and preserve failed/unknown outcomes without replaying uncertain writes; test create → provisioning failure → authorized open → confirmed recovery.

### 3. Staff memberships can miss later same-session role changes

**Confirmed cache behavior; end-user impact requires acceptance.** Standard-group setup is marked complete once per messaging target, principal and club. Role acknowledgement invalidates membership discovery but does not clear that independent completion set. Ordinary inbox upkeep does not force another synchronization. Membership top-up is add-only, so the inspected path also does not establish correct removal of former role holders from role-restricted staff groups.

Evidence: `frontend/src/live/defaultClubChats.ts:23–39,55–71`; `frontend/src/live/roleGrantsMemo.ts:5–11`; `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:364–374`.

**Required follow-up:** synchronize after confirmed role changes and verify current staff eligibility on the server, including both additions and removals. No claim is made that removed club members bypass the separate current-club-membership checks.

### 4. Repeating a large membership top-up can fail despite no new members

**Confirmed in source.** The helper sends all eligible candidates, including existing members. The service checks `existing count + submitted count > 500` before skipping duplicates. A group of 300 existing members resubmitted unchanged is refused as 600, although its real size would remain 300. A retry repeats the same refusal.

Evidence: `frontend/src/live/defaultClubChats.ts:68–71`; `backend/messaging_domain/src/main.mo:2757–2769`.

**Required follow-up:** count distinct resulting members before enforcing the existing 500-member cap; test repeated audiences and genuine growth beyond the cap.

### 5. Some Messages reads can silently become incomplete

**Confirmed error-discarding paths; user-visible occurrence unverified.** Team listing consumes only successful values from settled club/team reads. A failed group can disappear from a returned successful inbox. Group-directory refresh itself rejects failures correctly, but its preceding club lookup also consumes only successful values.

Evidence: `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:247–273,363–383`.

**Required follow-up:** preserve prior successful rows and surface incomplete refresh state rather than treating failed club discovery as an authoritative smaller inventory; test one failed group beside one successful group.

### 6. Club-admin authority and stored group-management roles can diverge

**Source-level concern.** Standard-chat reuse/top-up uses stored group membership/local roles rather than the existing live club-admin authorization helper. An administrator absent from an older group may not be able to repair it; ordinary existing metadata members are permitted to manage metadata by the current predicate.

Evidence: `backend/messaging_domain/src/main.mo:2228–2233,2579–2582,2626–2640,2762,3774–3796`.

**Required follow-up:** test a newly appointed club admin absent from the group and a removed staff member, without granting new access to unrelated personal groups.

### 7. Deliberately colliding canonical IDs need a scope-integrity test

**Risk, not a demonstrated data leak.** Canonical conversations use raw club/team IDs. Reusing an existing conversation ID merges participants without checking its stored club/team scope against the requested scope. Normal app-created UUIDs make accidental collisions unlikely, but caller-supplied IDs require defensive validation.

Evidence: `backend/messaging_domain/src/main.mo:710–731`; `backend/club_domain/src/main.mo:1221–1252`.

**Required follow-up:** refuse mismatched scope and test malicious club/team-ID collisions on disposable services. Current live membership checks remain relevant; this audit does not claim private messages were exposed.

### 8. Setup metadata failures can be hidden after creation

Country recording is caught/logged after club creation; the main app also catches general settings, logo and staff-chat failures. This avoids blindly recreating a club after a partial result, but does not provide a complete setup receipt or a visible repair path for every missing step.

Evidence: `frontend/src/live/features/club.ts:1049–1076`; `frontend/src/pages/CreateClubPage.tsx:202–270`.

**Required follow-up:** track/read back incomplete required setup and offer completion of the same club rather than another create. Logo failure alone must not be misreported as loss of the club.

## Important exception: personal teams

Club-owned team creation is wired to canonical chat provisioning. Personal ICP teams created without a club deliberately skip this backend provisioning path. Therefore “every team automatically gets a chat” is not currently true for personal teams. This is separate from the repaired club-admin visibility issue.

Evidence: `frontend/src/pages/CreateTeamPage.tsx:296–328`; `backend/club_domain/src/main.mo:1244–1251`.

## Verification performed

| Test batch | Email mode | Internet Identity mode |
|---|---:|---:|
| Placement, setup helpers, full inbox suite and thread access/recovery: 39 files per mode | 417 passed; 2 skipped | 418 passed; 1 skipped |
| Messages access and phone startup/resume safeguards: 5 files per mode | 30 passed | 30 passed |
| **Total per mode** | **447 passed; 2 skipped** | **448 passed; 1 skipped** |

**895 passing test executions; zero failures.** The same shared tests executed in two sign-in configurations are not 895 unique scenarios. Existing mode-specific skips remain. The preview's latest available build log reports `build OK`; no runtime error entry was present in the inspected log.

Evidence logs are stored alongside this report in `new-club-automatic-setup-audit-2026-11-23/`. Tests are mostly mocked feature/regression checks plus source guards. They validate the recent fixes and established recovery decisions, not the newly identified untested service defects. No disposable real-canister test was run in this audit.

## What remains unverified before a “just works” promise

- An authenticated fresh DEV create → setup → create team → Messages → send/read-back flow, followed by a second authorized member and a denied member. The preview authentication is external/unmanaged; no delegated Internet Identity session is available here.
- The same flow through ChatGPT's actual authenticated connector, including partial outcomes and stable-ID retry. Contract instructions were inspected; an external assistant session was not available.
- Exact current PROD deployment/configuration parity. Earlier owner-reported green workflows and previous public discovery evidence are not substituted for fresh verification in this audit.
- An updated installed Android/iPhone build, including cold launch and warm-cache resume. Source fixes do not update an already installed bundle.

## Recommendation

Keep production unchanged. Repair the priority staff-chat authorization, acknowledged provisioning and role-sync defects in DEV, add the missing regression cases, then complete the signed-in DEV acceptance chain. Treat the partial-read, cap and scope-collision issues as part of that same cohesive setup/chat repair. Only after verified code promotion and a new phone build should the next production club be described as fully checked.