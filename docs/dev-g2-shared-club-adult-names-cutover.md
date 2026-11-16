# DEV Group 2: restore shared club-name vetKeys (per original PII source)

**Status: code proposal only; release blocked pending exact ciphertext inventory and separate owner approval.** No canister upgrades, env changes, PII writes, key changes or migration are authorised by merging this code.

## Why this exists

The user-visible `CIPHERTEXT_TIMEOUT` on the Group 2 / ChatGPT Plugin Test U10 Team page identifies the original G1 PII ciphertext request, not the vetKD derivation. The original group-2 team-name release selected `scope.kind = "team"`, reading each adult's original `display_name` ciphertext (`vetkey-ibe-v1`), and a fresh **paid** vetKey per person on a successful read.

Ignite already has a separate per-club encrypted-name design:
- Each adult owns one original individual `display_name` ciphertext, retained for restricted audiences.
- Each club member has a *separate copy of their name ciphertext* encrypted under the shared identity `clubnames:<clubId>\u001fdisplay_name` and recorded as `club_display_name:<clubId>` with scheme `vetkey-club-names-v1:<clubId>`.
- `get_private_profile_names_batch` with an exact `club` audience selects club copies; `get_private_profile_club_name_vetkey` derives one club key **per PII source canister** rather than per-person vetKeys. In a cross-group roster containing both original G1 and modern G2 records, these are distinct keys because the original PII authorities differ.
- `fetchClubNameVetKey` checks the authorised ciphertext path and reuses the same session / device-held club key; per-person original keys are not the name-sharing architecture.

## Proposed narrow correction

1. **Frontend (default OFF):** `IGNITE_LIVE_DEV_G2_SHARED_CLUB_NAMES=1` only after the backend is ready, only for pinned DEV Identity/router/G2 Club/G2 PII. Team roster requests the owning **club ID** through the existing `readRelationshipProfiles(..., {kind:"club",resource:clubId})` and original G1 source resolver. Other screens, other targets and child-name reads retain their existing behaviour. Query keys separate old team-person and new shared-club results.
2. **Identity original G1 verification (default OFF):** `IGNITE_DEV_G2_SHARED_CLUB_NAMES_RELEASE=1` adds the exact registered G2 Club's **club** audience, independently of the existing team-name release. Identity still requires original G1 PII caller, configured allowlist, pinned key SHA-256, released generation-2 directory and router revision 11, valid original name references and current **club membership of viewer AND every subject** from two matching G2 Club checks.
3. **Original G1 and registered G2 PII:** The new release flag on the exact DEV PII canisters selects **only** saved `club_display_name:<clubId>` copies for G2 club audiences, rejecting absent, wrong-scheme or wrong-owner copies instead of falling back to original per-person name ciphertext. The original G1 canister additionally refuses the new club scope until the flag is on. Every authorised ciphertext/key read continues to check removal fences, account admission, and membership before/after awaited work.
4. **Frontend defence in depth:** The activated exact DEV club reader refuses all `vetkey-ibe-v1` adult-name rows **before** calling `fetchPiiVetKeys`. Missing converted copies are not silently repaired by a per-user key, cached personal name or browser-generated data. The existing shared-club-key mechanism remains the only paid key derivation for the roster.

## Prerequisites — read-only verified facts before activation

- Verify the exact DEV G1/G2 PII and Identity canister settings, verification-key fingerprints, routing and current frontend build; preserve their original vetKD key name (`key_1`) and ciphertext.
- Establish **per original PII owner** (including Test3, Test, and linked principals) whether their G2 club name copy exists and decrypts under the existing club key. Owner-authorised `read_private_club_name_lifecycle` can report the encrypted copy; do not print names or ciphertext in public CI or reports. The current live copy inventory was **not** established by this PR.
- In a separate approved **write** workflow, convert only records whose original ciphertext and ownership are authoritatively verified. A per-user encrypted original CANNOT be re-used as club-encrypted bytes; obtain an owner-authorised plaintext value for fresh local encryption under the existing, exact club identity, or use the repository's separately approved full-inventory fenced conversion procedure. Never create unknown/duplicate names; never transfer a personal key, copy someone else's name, or infer ownership from club membership alone.
- Verify Group 2 club membership of Test and Test3, including guardianship/alias cases, without widening child-name or family/email access.
- Add an isolated PocketIC/replica release test covering: exact club member sees same-club names, outside-club/removed/stale/transfer/foreign-source/foreign-key callers denied, missing/wrong copy never derives a personal name key, release defaults off, same club shared-key reuse, and post-revocation fresh ciphertext denial even if device holds a prior shared key. Existing unit tests are necessary but NOT sufficient to approve mainnet canister upgrades.

## Release sequence — NOT executed

1. Review PR CI and security patch; **merge only after approval** (merge itself can deploy frontend if code under `frontend/` changes, but cutover flag must remain unset).
2. Protected **read-only** preflight on both PII canisters and Identity; verify original public key and existing data; no write.
3. Separately approve any required copy preparation and independently verify every saved club replica. No missing copy may be disguised by an original personal read.
4. Separately approve exact DEV-only G1/G2 PII and Identity upgrades using existing owner-gated check+upgrade workflows, with settings/key/memory/controller/cycles continuity and live negative permission tests. Keep the new release flag OFF until readiness and an independently approved release action.
5. Enable `IGNITE_DEV_G2_SHARED_CLUB_NAMES_RELEASE=1` on the exact relevant DEV canisters through an approved change and verify release integrity; then explicitly build/deploy DEV frontend with `IGNITE_LIVE_DEV_G2_SHARED_CLUB_NAMES=1`. **Never** mirror these flags to PROD or Supabase.
6. Confirm as Test and Test3: all three existing children remain visible, both adult names load repeatedly; outsider names stay inaccessible; no individual-name vetKD derivation on team opens; count derivations **by PII source**, and inspect measured ciphertext latency and charged cycles. Switching to a shared club key alone may not cure the previously observed pre-key CIPHERTEXT_TIMEOUT because the existing inter-canister membership verification still occurs.

## Rollback and safety

If any check fails, **do not activate the frontend cutover**; keep the old deployed behaviour. If new reads fail after activation, disable the frontend cutover flag and revert only the DEV deployment via the existing controlled process; leave PII originals and saved club copies intact. Disable the DEV backend release flags only through an owner-reviewed protected settings change. Key reuse avoids repeated paid derivations but **does not** retroactively erase keys already delivered to devices; continuing fresh server-side membership and ciphertext checks is mandatory.

This is an architecture correction, not a claim that the missing copies are present or that G1/G2 live canisters have already been upgraded.

## Longer-term single-source consolidation (not in this PR)

If the user wants literally **one derived club-name key for a club regardless of original G1/G2 accounts**, encrypted club replicas must be held under **one canonical PII canister per owning club**, with verified conversion and migration from the other source. Because vetKD keys are bound to the originating PII canister and its context, equal club IDs across G1/G2 do not produce interchangeable keys. Consolidation requires ownership-proof, original-key attestation, ciphertext conversion, copy-lifecycle/revocation tests and a separately approved data move. Do not disguise a two-source key arrangement as a global one-key-per-club design; the current guarded PR is a low-cycle partial restoration, not a cross-source consolidation.


## Read-only inventory and security checkpoint — 16 November 2026

This checkpoint used the **official DFINITY ICP connector as a diagnostic client only**; the Ignite application does not use or depend on ChatGPT. The connected Test3 Internet Identity performed the existing synchronous owner-only `read_private_club_name_lifecycle` method. No name, ciphertext, personal vetKey, plaintext, child record, PII grant or membership was changed or copied.

- Verified the live Ignite DEV frontend's `/.well-known/ic-architecture` declares original G1 PII `iui5p-aaaaa-aaaal-qxllq-cai`, Group 2 PII `zt5a6-yiaaa-aaaal-qxp5q-cai`, Identity `mq2sj-fiaaa-aaaal-qxlqa-cai` and Group 2 Club `yfwyv-nyaaa-aaaal-qxpyq-cai`.
- Against **club `177f8c01-3617-402a-aedd-5c5c17ccfde1`**, Test3's authenticated owner-only read returned a **present, owner/scheme-validated encrypted club-name replica on original G1 PII**, and `Ok(null)` on Group 2 PII. The read method verifies `domain_owner == subject` and `master_key_id == vetkey-club-names-v1:<clubId>` before reporting a present copy. It does not derive a key or prove that the ciphertext decrypts.
- Verified live original G1 PII `pii_vetkey_verification_key` is 96 bytes and its SHA-256 is **`f80ed20bc0d8a244f40b31fdbd0024ff469d24254197dce9242dce669fa1f34d`**, matching the independently pinned source constant in `backend/identity_access/src/legacy_g1_private_name.rs`. This confirms live *public-key continuity with that pin*, not the full historical provenance of encrypted records.
- Verified Group 2 PII uses a **different** 96-byte derived public key (SHA-256 `da6301af55047af0a5faac96f522d90b4f0a453c217601bb1932d3093bc1231b`), so its shared-club vetKey is not interchangeable with the original G1 key even at the same club ID.
- Test's official connector grant has expired; no Test-subject owner-only read was attempted. A different connected “Test full access” principal must not be substituted for Test. **Inventory remains incomplete** until Test's own subject/copy is verified under authenticated owner access.
- Group 2's OQL Team query returned `Use protected consensus account read`. This is a **blocked caller-permission surface**, not evidence that Test3 is not a club member; do not bypass it with an unrestricted raw list.
- No live test of `get_private_profile_names_batch` with `club` scope was made because the separate release is not active, and no paid `vetKD` name-key derivations were performed. The pre-existing `CIPHERTEXT_TIMEOUT` may remain because ciphertext retrieval still performs expensive repeated G1 PII → Identity → Group 2 Club authorisation.

**Hold for next approval:** authenticated Test owner-only replica read, existing club/subject membership admission proof through supported protected read (or a narrowly scoped governor preflight), read-only check of default-OFF release flags on both PII and Identity, and isolated negative/held-callback tests specifically for the new club scope. Do not merge or enable this cutover merely because Test3 already has a saved copy or CI is green.
