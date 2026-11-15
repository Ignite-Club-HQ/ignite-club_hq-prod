# Ignite DEV: teammate display names when the original adult PII belongs to Group 1

**Status: source verification prepared; real name release BLOCKED.**

The prepared check never deploys or upgrades canisters, changes routing or
permissions, writes PII, rotates keys, sends notifications or touches PROD.
However, **merging a PR that changes `frontend/` may automatically trigger the
repository's normal DEV frontend deployment**, even if no visible UI behavior
changes. Treat merge as a separate owner-reviewed action. Ignite DEV
canisters run on the ICP public mainnet.

## What the browser and canisters show

The Team screen in Group 2 test / ChatGPT Plugin Test U10 now correctly shows
both children (Ted and Dingo) and one adult (Test). The second parent is a
verified team member but shows `Name unavailable`; their Identity profile's
encrypted display-name reference identifies the **original Group 1 PII** vault.

The official DFINITY connector's read of DEV router
`jcdfe-vqaaa-aaaal-qxloq-cai`,
`read_group_registry("mainnet")`, returned registry **revision 11** and
only the newer **G2** registration and placement.

**Important architecture clarification:** This does **not** establish a
missing registration defect. Existing
`scripts/membership-lookup-release-policy.mjs` intentionally adds the
operator-pinned original **G1 Club** as a legacy source when the modern router
registers only G2. The existing identity-owned permanent membership directory
uses that explicit G1 source. **Do not register a fabricated G1 placement.**

Pinned source-controlled DEV service IDs:
- Original G1 Club: `mzzzv-taaaa-aaaal-qxlrq-cai`
- Original G1 PII: `iui5p-aaaaa-aaaal-qxllq-cai`
- Identity: `mq2sj-fiaaa-aaaal-qxlqa-cai`
- Registered G2 Club: `yfwyv-nyaaa-aaaal-qxpyq-cai`
- Registered G2 PII: `zt5a6-yiaaa-aaaal-qxp5q-cai`

These pins identify intended canisters; **they are not proof that the original
PII key, service allowlist and release permissions are currently safe.**

## Protected read-only preflight (separate owner approval)

New workflow `[TEST] DEV legacy G1 name origin read-only check` (only available
after separate review and merge of PR #1542) is manual on `main` and uses the
existing protected `group-2-admin-controls` environment and original governor
credential. Run with confirmation `CHECK LEGACY G1 SOURCE ONLY`.

It reads only:

1. An authenticated, revision-pinned **G2 router registry snapshot**.
2. The existing Identity `read_membership_directory_configuration`, which
   should independently attest `g1` original Club plus all registered
   modern Club sources. It is **governor-only** and was not yet verified in the
   live environment while preparing this PR.
3. The original G1 PII canister's **public verification key** (SHA-256
   fingerprint only, no raw key or personal names in reports).

The script rechecks the router and Identity directory after all awaits to
catch changes. It is intentionally incapable of authorising names:
`nameReadAuthorised: false`, `originalKeyMatchesHistoricalBaseline: false`,
`originalPiiIdentityAllowlistVerified: false` and
`teamOnlyNamePermissionVerified: false`. A green check means the reported
topology is consistent, **not** that Group 2 is entitled to decrypt a name.

The existing strict `verifyCrossGroupTeamNameRoute` requires both groups
in a single registry; it is an appropriate guard for an all-registered
deployment, but **not the default architecture** of this DEV legacy-G1
layout. The new `inspectLegacyGroup1TeamNameTopology` instead audits the
registered modern group and independently Identity-pinned G1 source.
Neither grants user access.

## Other mandatory release gates

1. **Original PII authority and key continuity:** Compare the live public-key
   fingerprint to independently archived G1 pre-release evidence. Verify
   original G1 PII's configured Identity verifier and service allowlist;
   do not use G2 PII as a replacement or copy a plaintext name.
2. **Identity cross-group trust:** `backend/identity_access/src/lib.rs`
   currently validates the original PII caller by checking membership in
   the router's registered `pii_access_control` domains. Since G1 is an
   intentional **legacy** source, this check cannot currently admit the
   original G1 PII. Any change needs a separately reviewed, server-side
   attestation using the already pinned Identity legacy source **and**
   independently authenticated original G1 PII settings, not a hardcoded
   browser profile reference.
3. **Team-only permission:** The existing `club` name audience uses
   `read_profile_membership_batch`, which is too broad for Team rosters.
   Draft PR #1543 adds an exact team-scoped server permission and regression
   tests. It must remain unmerged until the original authority is verified,
   reviewed for guardian alias/revocation semantics, and negative PocketIC
   tests cover other-team, other-club, transfer, stale data and wrong caller.
4. **Release management:** After all gates pass, a separate owner-approved
   exact-canister DEV release must preserve original key, ciphertext,
   children, memberships, controllers and settings. Only then integrate
   the frontend's legitimate, team-scoped source resolver. Never enable
   rehearsal-only flags on public mainnet.

## Current scope

PR #1542 is **read-only verification and tests**, no production reader.
PR #1543 is **draft non-activated backend implementation**, no release.
The final user test is simply loading the U10 team as both existing parents,
confirming their authorised teammate names and checking another team/club
cannot read them. Do not create new children, duplicate Ted/Dingo or modify
either parent's PII to test routing.


## 16 November 2026: observed live revision drift — do not reconfigure yet

The approved `DEV legacy G1 name origin read-only check` completed its
main/confirmation gate and governor-only Identity configuration read. It
failed with: `Identity directory revision differs from the live router
revision`. That is a **real currentness blocker**, not a name decryption
error and not evidence of a missing child or membership record.

`identity_access.configure_membership_directory` rejects replacement
of an existing directory if its pinned binding, generation, inventory digest,
sources or enabled state differs. It reports `Directory replacement requires
fenced recovery; not released`. Thus, neither increasing a client-side
revision constant nor blindly rerunning `RELEASE MEMBERSHIP LOOKUP`
is a safe reconciliation.

The next protected workflow will record **only** the two revision numbers,
status booleans and confirmation that two independent authenticated readbacks
agree. On revision mismatch, it writes a `blocked` report artifact and
deliberately fails before any private/public key operation. It does not
pin the new revision, enable the reader, alter service inventories or grant
PII access.

A later recovery proposal must independently establish why the router
revision changed, compare the source inventory at each revision, preserve
invalidation watermark, life-cycle and ownership evidence, and implement
a governor-gated, journaled **fenced transition** with isolated replica
tests before any separate owner-approved DEV change. Existing records,
sources, children and private keys must not be overwritten or replayed.
Draft PR #1543 remains on hold.


## 16 November — simplified disposable DEV directory reset (draft; **not executed**)

There are no real ICP clubs/users in this installation, so preserving disposable
membership-directory indexes across revisions is not worth a general migration
framework. **Do not reinstall the shared original Identity canister:** it owns
account, account-link, family and private-profile references independent of
the membership directory. The original shared DEV mainnet Identity is
`mq2sj-fiaaa-aaaal-qxlqa-cai`.

This proposed one-off code path is scoped to the original DEV Identity,
the existing governor, the exact unreleased generation-1 G1/G2 directory
inventory, saved router revision 7 and current router revision 11. It refuses
if production account authorisation or a released directory is present.
It reads the exact live registered G2 inventory twice and verifies source
and lifecycle pins; there is no fabricated modern G1 registry placement.

After a separate owner-approved upgrade of **only the original DEV Identity
canister**, the protected
`[DEV only] Disposable membership directory reset (router 7 -> 11)`
workflow supports two explicit manual actions:
- `check`: governor-authenticated read-only preflight; never resets anything
- `reset`: requires `RESET IGNITE DEV DIRECTORY 7 TO 11` and a protected
  environment approval. The one-off Identity method discards only
  membership-directory coordinator, namespace pool, worker, update journal
  and cached private lookup pages, preserving the anti-replay instance counter.
  It leaves account, profile, principal, team/child and PII stores alone.

The approved runner then configures the directory at router revision 11 and
generation 2, rebinds original G1 and G2 Club directory-source endpoints at
the newer generation, and reads all bindings back. It **does not** fill or
release the membership directory, enable adult private-name reading, edit
any club record, or touch PROD. Filling/ownership and the separate encrypted
G1 name-release checks remain pending; draft PR #1543 must stay unmerged.

If the live router advances beyond 11, existing release is enabled,
non-DEV source inventory is detected, worker/index budgets are exceeded,
or any prerequisite is absent, **stop**. Do not guess new revisions, reset
the entire Identity canister, or reuse this one-off tool for a later release.
Any mid-flight refusal is left explicit for a scoped follow-up rather than
blind retry or a broad release workflow.

No DEV canister was upgraded, reset or configured by preparing this PR.


### Identity-only DEV upgrade (separate owner approval)

The existing `[TEST] Upgrade backend (all test groups)` workflow now has
`scope = dev_identity_directory`. The source policy accepts exactly the
one shared `identity_access` target, not notification, Club, PII, router or
PROD targets. Use `action = check` to obtain and review the checked plan
hash before any upgrade. A subsequent, **separately approved** `upgrade`
requires:
- `scope = dev_identity_directory`
- `checked_plan =` exact observed 64-character hash
- confirmation `UPGRADE DEV IDENTITY DIRECTORY ONLY`

The directory reset is a separate protected workflow with separate approval:
`[TEST] DEV-only disposable membership directory reset (router 7 -> 11)`.
First run its read-only `check` action. Only after reviewing those facts
can the `reset` action be authorised. Neither merge nor frontend deployment
automatically executes either upgrade or reset.
