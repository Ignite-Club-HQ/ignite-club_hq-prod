# ICP-wide shared club-name encryption contract

**Repository design requirement:** every ICP club uses a separate `club_display_name:<clubId>` ciphertext and a shared club-name vetKey identity `clubnames:<clubId>`. Every team inherits the owning club's key. No adult member-name display may derive keys individually or invent its own team-wide key. Sensitive non-name PII and child/guardian records retain their distinct existing authorisation. The email/Supabase backend remains unchanged.

**Status:** proposed implementation on PR #1566, **not deployed, merged, migrated or released**. The code is universal across ICP clubs when enabled, but existing live PII may lack copies and MUST NOT be forced into a silent personal-key fallback. Do not turn on the global flag before clubs can pass a deterministic owner-authorised copy audit or preparation. Until then the current running app still uses its old behaviour.

## All-club/all-team implementation

- Frontend build flag `IGNITE_LIVE_SHARED_CLUB_NAMES=1` enables the same exact-club name policy on every enabled ICP target, not a hardcoded club or team. ICP Team Detail takes the team's resolved authoritative `club_id` and calls `readRelationshipProfiles(...,{kind:'club',resource:clubId})`; the standalone `kind:'team'` private-name reader refuses to use a team/person key under the release. All other club-name screens already request club audiences; unknown or missing original source routes fail closed.
- The original G1 → registered G2 DEV cross-group resolver remains pinned to the original PII service, verified source public key, G2 router, Identity and owning G2 Club. It now supports **every exact registered G2 club ID** rather than only U10, but each viewer and named subject is rechecked against that exact club through the existing server-side authority on every ciphertext/key read. This does not license arbitrary foreign sources, inferred G1 registry placements or PROD.
- Every ICP PII canister must enable `IGNITE_SHARED_CLUB_NAME_ENFORCEMENT_RELEASE=1` for all-club consistency. Under this switch its `get_private_profile_names_batch` serves **only** the saved `club_display_name:<clubId>` copy with exact owner and `vetkey-club-names-v1:<clubId>` scheme; missing or wrong copies return an error, **never the original personal ciphertext**. Its personal-key `get_private_profile_name_vetkeys_batch` refuses club scope and the private-name release excludes team scope. Only the independently authorised `get_private_profile_club_name_vetkey` endpoint derives the shared club key.
- The frontend rejects individual ciphertext on any ICP club scope under the same cutover flag before calling any individual-key relay, and rechecks ciphertext/member authorisation even after a cached club key. Owner profile saves can refresh that owner's club-encrypted copies using the existing authoritatively discovered club memberships, with the original personal ciphertext unchanged.
- `IGNITE_DEV_G2_SHARED_CLUB_NAMES_RELEASE=1` is **additionally required** on the specific original G1/registered G2 DEV cross-group PII + Identity pair. It is a source-identity authorisation pin, not the general club-key switch. `IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE=1`, original PII allowlists and other release fences remain necessary. PROD/other groups use their own protected settings, no cross-group G1 exception.

## Key and cycle accounting

One club-name identity is shared by all members/teams of the same club **within each PII canister**. A cached device-held key avoids repeated paid vetKD derivation on subsequent authorised reads. Teams **never** get their own name-key identities. When a club has members' original ciphertext split across G1 and G2, the two PII source canisters use distinct verification keys; there can therefore be up to **one reusable club key per originating source**, not literally one key total. A single canonical PII source/key per club requires a separately authorised migration of encrypted copies; this PR does not silently transfer, reencrypt or delete any name data.

There remains a *pre-key* performance bottleneck: the original PII → Identity → Club authorisation is repeated, including a closing verification. Key sharing reduces derivation costs but does not prove the earlier `CIPHERTEXT_TIMEOUT` is fixed. Optimise this with bounded, revocation-safe server snapshots only after measuring the same-club check costs; never bypass the membership checks.

## Verified read-only evidence (16 November 2026)

- In the test Group 2 club `177f8c01-3617-402a-aedd-5c5c17ccfde1`, Test3's owner-authorised read reports an **existing, valid-scheme club-encrypted name copy on the original G1 PII** and no copy on G2 PII. No copy was recreated and no decryption key requested.
- The original G1 PII public key matched the pinned SHA-256 `f80ed20bc0d8a244f40b31fdbd0024ff469d24254197dce9242dce669fa1f34d`; the G2 PII key was different.
- Test3's membership in that exact G2 club was verified via the Club canister's protected read; Test's distinct connector grant had expired, so Test's existing club copy was not inspected. It is not necessary to reconnect ChatGPT for the app itself.
- Original U10 child names were visible and are not changed by the member display-name cutover.

## Required rollout order (not executed)

1. Review all tests and current complete diff. Verify unit and replica/PocketIC negative tests for: two clubs with different keys; two teams in the same club using the same key; nonmembers, revoked/removed/transfer-fenced members and unrelated canister sources denied; changing roster across awaits rejected; no individual name vetKey ever derived under shared-name mode; PROD flags remain off.
2. Audit each club's existing name-copy coverage per **original source PII**, owner-authorised. Prepare missing encrypted copies via the existing owner-confirmed write workflow, only with separate approval. All-club release must not start if an active club's member has only personal ciphertext and no valid club copy.
3. Separately approve exact DEV canister upgrades and protected settings changes, preserve persistent state, vetKD key name, controllers and observed fingerprints; enable both G1→G2 source gates and the global PII enforcement flag only after readiness. Deploy the frontend with global release flag only after backend readiness.
4. Confirm Test can see Test3 and all three existing children; test a second club and multiple teams under that club; repeat as an unrelated user to confirm denial; measure actual latency and cycles against the old implementation.
5. Extend to other ICP groups and eventually PROD via their independently approved, source-pinned migration/release controls. No legacy Supabase/email changes. A failed readiness or test leaves flags off; do not fall back to per-person keys.

**Explicit limit:** PR #1566 puts the **all-clubs rule into source code** but does not itself prove copy coverage, complete multi-group support, PROD rollout readiness or a successful live name read. This distinction must be preserved in release notes and user reports.
