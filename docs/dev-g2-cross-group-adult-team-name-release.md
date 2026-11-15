# DEV Group 2: parent display names when original PII belongs to Group 1

**Status: release BLOCKED — read-only audit and tests only.**
This is Ignite DEV on the ICP public mainnet. No migration, name write,
key rotation, grant change, canister upgrade, registry mutation, notification,
or PROD deployment is authorised by this document.

## Evidence (15 November 2026)

The U10 Team screen now shows children **Ted** and **Dingo** correctly, along
with one named adult. The second parent is legitimately on the team, but their
identity profile references the **original Group 1 PII service**; the Group 2
name reader deliberately returns `Name unavailable`.

The official DFINITY connector's consensus read of the existing DEV
`shard_router` `jcdfe-vqaaa-aaaal-qxloq-cai`,
`read_group_registry("mainnet")`, reported **revision 11** with **only
Group 2** in the registered groups/placements. These are observed routing
facts, not approval to register a missing group:

- Group 1 legacy Club `mzzzv-taaaa-aaaal-qxlrq-cai`; original Group 1
  PII `iui5p-aaaaa-aaaal-qxllq-cai`.
- Group 2 Club `yfwyv-nyaaa-aaaal-qxpyq-cai`; Group 2 PII
  `zt5a6-yiaaa-aaaal-qxp5q-cai`.

**An incomplete registry cannot independently authenticate the Group 1
original PII service.** Do NOT infer trust from an encrypted profile reference,
or from the fact that a Group 2 member can read Group 2 children's names.
The `accountAuthoritiesFromRegistry` validator rejects missing independently
pinned original club authorities. A separate/group-specific router might own
legacy placement; do not enrol or alter Group 1 on the Group 2 router without
explicit owner-approved architecture and full placement evidence.

## Separate, mandatory release gates

1. **Operator-attested source inventory**: independently validate each
   group's complete set of domains, exact approved subnets, registry revision,
   original Group 1 PII/public key and exact target Group 2 Club authority.
   If a legacy group has a different router, define and security-review a
   two-router trust protocol before production routing. Do not self-pin using
   client-supplied references or current membership.
2. **Team-only, server-enforced name permission**: the currently released
   `club` audience uses `read_profile_membership_batch`, which verifies
   membership in a **club**, not a specific team. The user's requested Team
   roster visibility needs a **team-scoped** backend audience. Identity must
   confirm both viewer and named subject are current verified teammates via
   the owning Group 2 Club, before AND after PII key derivation. For parents
   linked through children, preserve guardian rules; exclude removed, blocked,
   unlinked, transferred and expired team relationships.
3. **Original Group 1 authority**: confirm the PII canister retains its
   original key and a separately approved, securely pinned Identity verifier;
   do not enable rehearsal flags on live mainnet, add broad club-name grants,
   copy private names into plaintext, or substitute the Group 2 PII service.
   Identity must authenticate the **original PII caller** and the currently
   registered team authority with the precise source reference and account.
4. **Privacy/security regression**: isolated PocketIC tests must cover
   same-team positive, other-team same-club negative, other-club negative,
   forged authority, outsider/anonymous, revoked and transferred membership,
   guardian aliases, expired release, changed registry revision, failed
   cross-canister calls, changed ciphertext and key, no email or unrelated
   field access, no user-data logging and no unauthorized replays.
5. **Separately approved DEV canister rollout**: build/inspect exact changed
   services and use owner-gated, immutable release hashes and readbacks.
   Keep the frontend dormant until the canisters and independent deployment
   evidence pass; never rely on a frontend flag alone to grant private names.
   Test the existing U10 team using the two known test parents, not by
   creating new children.

## Current code audit

- `frontend/src/live/privateProfileAuthority.ts` has a pinned, revalidated
  original-service resolver that requires separately supplied
  `AccountRegistryBinding`. No deployment-wide evidence reader is currently
  registered by the normal app bootstrap.
- `frontend/src/live/relationshipProfileRead.ts` deliberately keeps foreign
  authority routing off in hosted mode. Enabling the resolver alone would
  not solve missing original-authority registration or team-only permission.
- `backend/identity_access/src/lib.rs` currently authorises `club` names
  by calling the Club `read_profile_membership_batch`, whose verified scope
  is club membership, not team membership.
- Group 1's original encrypted name must remain under its original source
  and verification key. Group 2 team role IDs alone grant no PII authority.

This PR adds only a **fail-closed, testable topology check**. Its successful
return explicitly says `nameReadAuthorised: false`. It never enables a
reader, adds an audience, discloses a name or changes a profile. A later
separately reviewed team-scope/security implementation is necessary.
