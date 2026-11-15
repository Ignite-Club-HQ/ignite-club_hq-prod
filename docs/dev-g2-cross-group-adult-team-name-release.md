# Ignite DEV: teammate display names when the original adult PII belongs to Group 1

**Status: source verification prepared; real name release BLOCKED.**

No deployment, canister upgrade, registry change, permissions grant, PII write,
key rotation, notification, or PROD change is part of these PRs. Ignite DEV
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
