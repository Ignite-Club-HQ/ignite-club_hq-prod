# DEV acceptance: real input and readback

**Not yet executed.** Offline tests, public proxy queries and compiler checks do not count as signed-in DEV acceptance. Mark each case with source/artifact hashes, exact DEV inventory, observed result and date. Do not use production accounts/data or capture private credentials, names, keys or ciphertext in reports.

## Preconditions

- Exact 32-part DEV inventory/empty before-images/controllers/subnet reviewed.
- Operator management transport, direct governor calls and frontend asset-upload transport are independently supported and authorized.
- Engine-aware zero-cycle resource policy, fresh G1 identity/bootstrap, protection/lifecycle evidence and engine-specific private-name commissioning are resolved without weakening existing access.
- Both groups' reciprocal configuration is read back; admissions/routing remain held until the correct existing acceptance protocol authorizes the desired DEV test.

## Fresh-install safeguards

- The 32-target package contains no witness install or recovery signing action; leave `c6dso-4iaaa-aaac5-aaeqa-cai` empty and untouched.
- Before commissioning, non-governor commissioning and ordinary registration/profile writes are denied. The initialized governor account alone is expected.
- Wrong host/environment, role-swapped IDs, incomplete inventory, mismatched modules, removal-enabled/rehearsal receivers, pending work, prior user data and non-install history must be refused.
- Save the successful `commission_fresh_opencloud_dev` receipt; identical retry returns it without replacing pins, conflicting retry refuses. Read it back through `read_fresh_opencloud_dev_commissioning`, which checks all 31 live backend lifecycles.
- Global account erasure/recovery stay denied, including after ordinary member admission is disabled. No reset, snapshot load, reinstall or upgrade is authorized for testing the actual installation.
- On separately authorized disposable local instances only, test pre-commission snapshot restore, post-commission single/joint restore and same-module upgrade: management lifecycle changes must deny access/recommissioning. Do not perform destructive lifecycle probes on these 32 DEV targets.

## Functional flow

1. Sign in through the DEV frontend's `.icp.net` address with Internet Identity; return to the same DEV identity/profile. Test desktop and a real phone. Confirm no request reaches existing mainnet application canisters and no stored-mainnet/email routing is silently adopted.
2. Complete a fresh profile. The canister must save only the verified encrypted reference, not the submitted plaintext. Read back through the UI after sign-out/sign-in. An unreleased authority or failed encryption/decryption must fail the save without a plaintext retry or a success cache.
3. Create a fresh test club/team using the existing authorized commissioning/test path; invite and sign in a second DEV member. Verify exact membership, club/role grants and group placement. A third unrelated user must not gain club access.
4. Create/edit an event, assign a duty, reply to attendance, start/return to a pitch board and send a chat message/reaction. Read each result back through the UI with its exact event/chat/club authorization; no replay of unknown writes.
5. Upload a small real photo. Read the stored bytes as ciphertext; uploader and authorized club member decrypt the exact original bytes through the UI. A nonmember cannot upload or obtain a fresh key. Repeat for a club-wide image and a restricted vault document; ordinary club membership must not grant the latter.
6. Save/read real adult and child names under the existing club/team audience rules, including membership exclusions. Failed unlocks show neutral placeholders/errors, never plaintext network/storage fallback. An unrelated club/team member receives no key.
7. Remove the second member from the relevant scope; on the next authorized read, fresh keys/reads are refused. Retained device key/cache behavior stays consistent with existing policy; do not claim instant erasure of already unlocked device material.
8. Reopen on the phone, test app foreground/reconnect and confirm correct DEV data/permissions. Native builds are not produced or retargeted in this task; installed-native acceptance requires a separately reviewed DEV phone build.

## Cryptographic acceptance

- From the **installed DEV PII callers**, obtain the real public verification keys and a real proxy-derived encrypted vetKey; SDK `decryptAndVerify` must pass under the original identity/context, then decrypt the uploaded bytes exactly.
- Compare G1/G2 derivations for the same logical identity; they must differ. Verify an unrelated caller cannot access either's keys.
- When PROD is later explicitly commissioned, repeat under PROD's own PII callers and verify cross-environment decryption failure. **Do not call PROD key derivation or install PROD just to complete this checklist now.** Offline four-caller checks cover only the published algorithm, not live PROD acceptance.
- Test insufficient/unavailable proxy, authorization refusal and invalid reply bytes: preserve ciphertext and fail closed; no raw URL/plain storage fallback or automatic uncertain paid replay.
- Initial fresh-mode identity upgrades refuse; changed receiver lifecycles deny scoped access. Any later state-preserving DEV upgrade requires a separately reviewed lifecycle path plus original proxy/key and photo/name readback. Initial commissioning cannot authorize it.

## Isolation and release outcome

Check no mainnet/Supabase data, routing/configuration, DNS, controllers, scheduler/worker, subscription/payment or CI workflow was changed. Push/AI/migration remain uncommissioned. Any failed or unknown case keeps the DEV functional release held, with the exact blocker recorded. PROD remains inactive regardless.