# DEV — all-club shared display-name key release

Status: **not activated**. PR #1566 is merged into main; the source now requests a club-shared encrypted name copy for every ICP club and all its teams only when `IGNITE_LIVE_SHARED_CLUB_NAMES=1`. On the PII side `IGNITE_SHARED_CLUB_NAME_ENFORCEMENT_RELEASE=1` refuses individual ciphertext on every club-name read, and `IGNITE_DEV_G2_SHARED_CLUB_NAMES_RELEASE=1` separately enables the pinned original Group 1 -> Group 2 source. These server flags are not automatically set by a frontend deployment. PROD and Supabase/email remain unchanged.

## Approval-gated DEV frontend build

The existing `[TEST] Deploy web app (frontend canister)` workflow now compiles `IGNITE_LIVE_SHARED_CLUB_NAMES` from exactly the GitHub repository variable `IGNITE_DEV_SHARED_CLUB_NAMES_RELEASE_READY`, **only** when its source ref is `refs/heads/main` and the variable's literal value is `true`. An unset variable, `false`, or a non-main source compiles **0**. Normal main push and manual builds agree, so a later push will not inadvertently undo an approved cutover.

Never set that variable to true until the exact backend flags are active on the appropriate DEV PII/Identity canisters, with successful complete club-replica readback and outsider/removed-member denial. A frontend build cannot confer server-side membership permissions.

## Required next step — protected read-only preflight (no canister changes)

Open [Upgrade backend (all test groups)](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/workflows/upgrade-all-groups.yml), select **Run workflow**, branch `main`, action **check**, scope **private_club_name_display**; leave confirmation and checked_plan blank. This performs the existing journaled group inventory, PII key continuity and settings/wiring check. It **does not** attest how many member-name copies each club contains, and must not be interpreted as permission to enable the new flag.

Use the separate [DEV original Group 1 PII authority audit](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/workflows/dev-g1-private-name-authority-audit.yml) with action `check`, confirmation `AUDIT DEV ORIGINAL G1 PII AUTHORITY READ ONLY`, if the G1 source pin needs renewed independent attestation.

## Protected all-club metadata coverage audit (new; does not activate encryption)

This branch adds `[TEST] DEV all-club encrypted-name copy coverage (read-only)`
(`.github/workflows/dev-club-name-coverage-audit.yml`), with a manual
`action=check` and confirmation
`AUDIT DEV CLUB NAME COPIES READ ONLY`. Pull requests only run unit and
contract tests; private DEV governor credentials are never exposed to PR jobs.

The runner inventories **both** G1 and G2 governor-authorized membership
source pages, and the complete governor-only Identity account pages.
It validates active club/source ownership, account aliases, encrypted-name
reference authority and per-club membership. It does NOT use ordinary club
member access, infer membership from UI names, export a roster, or decrypt PII.
It checks that source snapshots are identical before and after the audit.

**A new backend reader is required for actual copy counts.** The exact G1/G2
PII canisters do not currently support the metadata-only
`read_dev_private_club_name_replica_coverage` method; this code-only addition
must be reviewed and deployed in a **separately approved, journaled DEV-only
canister upgrade**. Until then the manual workflow may report
`unverified`, not `copy_missing` or `copy_verified`. The runner will
never treat an unsupported reader as proof of no missing copies. Its artifact
contains only bounded counts and gate statuses. No names, principal IDs,
account IDs, plaintext, ciphertext or key material are written.

The new governor-only method checks only the subject's original
`vetkey-ibe-v1` record and exact saved `vetkey-club-names-v1:<clubId>`
metadata. It returns `copy_verified`, `copy_missing`, `copy_invalid`,
`original_missing`, `original_invalid` or `ambiguous`, **not** the
record or a vetKey. It does not alter the existing owner-only copy lifecycle
read/refresh, or grant a member access to a club's names.

Even if all metadata copies are verified, this audit always records
`readyToReleaseName=false`: independent original-key provenance, owner
readback and outsider/removed-member denial tests remain mandatory. Do not
enable any G1→G2 or global club-name switch based on this audit alone.

## Staged PII-only metadata reader installation (not authorised by this runbook)

A separate `dev_club_name_coverage_reader` scope has been prepared on the
protected **[TEST] Upgrade backend (all test groups)** workflow. Its exact
targets are only the original G1 PII
`iui5p-aaaaa-aaaal-qxllq-cai` and G2 PII
`zt5a6-yiaaa-aaaal-qxp5q-cai`. The scope excludes
`identity_access`, `club_domain`, notification services, PROD and
Supabase. This **module-only upgrade** preserves the existing PII settings,
`VETKD_KEY_NAME=key_1`, original vetKey verification fingerprints,
controllers, cycles and Motoko stable memory. Its journaling and snapshot
verification are the existing all-group protected release mechanism.

**First run read-only preflight after this PR merges:**

- Workflow: `.github/workflows/upgrade-all-groups.yml`
- Branch: `main`
- Action: `check`
- Scope: `dev_club_name_coverage_reader`
- Checked plan and confirmation: leave blank
- Inspect the saved `check.json` plan, exact two target canisters,
  before/after public key hashes, settings hash, unrelated release flags and
  previous release journals. No canisters are upgraded in check mode.

**A separate approval is required before any live upgrade**. Only if
preflight and release safeguards are reviewed may an operator deliberately
choose `action=upgrade` with the **exact checked plan SHA-256**
and confirmation `UPGRADE DEV NAME COVERAGE READER ONLY`.
An absent/guessed plan hash, wrong source branch, wrong canister,
additional group, or older pending release fails closed. The upgrade runner
has no settings-activation path for this scope and must not change the
shared-club release flags. Successful compilation alone is not sufficient.

After an independently approved reader-only PII upgrade, use the existing
`dev-club-name-coverage-audit.yml` manual check with confirmation
`AUDIT DEV CLUB NAME COPIES READ ONLY`. It produces count-only results
for the two previously missing parent name copies; failure or missing copy
coverage is **not** permission to turn on global club-wide decryption.

**Never** run scope `shared_club_name_enforcement` as a substitute for
`dev_club_name_coverage_reader`: the former explicitly **sets release
switches** and is beyond this reader-only stage.

## Focused G2 U10 Parent-name metadata check

The protected `[TEST] DEV all-club encrypted-name copy coverage (read-only)`
audit now also reports `parentFocus` for the **two confirmed, disposable
Group 2 U10 parents** currently displaying `Name unavailable`.
It reuses the signed original Group 1/Group 2 membership and account
inventory, plus the same governor-only PII metadata reads already performed
by the all-club audit. It does **not** make a new name-read call, derive a
key, add member access, create encrypted copies or change either PII canister.

In the `dev-club-name-copy-coverage-summary/check.json` artifact, inspect
`parentFocus.parents`. The labels `Test2` and `Other parent` identify
the previously verified DEV fixture identities only; no principal IDs, club
IDs, personal names, ciphertext or vetKeys appear in the artifact.
`copy_missing` means that a candidate in a verified membership with a
valid original reference has no saved replica for this club. By contrast
`copy_unverified`, `membership_not_verified`,
`account_mapping_not_verified`, `profile_reference_missing`,
`legacy_name_reference` and `source_not_original_g1` do **not**
establish an absent replica. An unstable source snapshot blocks the focus.

Even `copy_verified` does **not** prove the G1→G2 authorisation path works:
the live name read previously timed out independently. **No blanket
migration or governor-written name refresh is authorised by this check.**
For genuinely missing copies, prepare a separate existing **owner-signed,
create-only, original-ciphertext-pinned** refresh with explicit approval;
never fabricate a user name or use individual display-name keys.

## Before any activation

1. Protected membership inventory of all active DEV clubs, team-member subject aliases and each subject's original PII authority. No browser-provided or guessed source, no raw plaintext/name/key export.
2. Owner-authorised encrypted club-name replica coverage for each `(source PII, subject, clubId)`. A copy is valid only when its owner and `vetkey-club-names-v1:<clubId>` scheme match. The one known Test3 copy is present on original G1 PII for club `177f8c01-3617-402a-aedd-5c5c17ccfde1`; Test's copy and all other clubs are **unverified**.
3. Prepare missing copies only through the existing owner-authorised, original-ciphertext-fenced workflow; no public club roster dumps, plaintext exposure, or guessed re-encryption. A personal `vetkey-ibe-v1` ciphertext is NOT a club-encrypted copy. Where the same club spans multiple PII canisters, each source uses its own reusable shared club key.
4. The protected all-group upgrade plan must deliberately install the new PII/Identity modules, preserve `VETKD_KEY_NAME=key_1`, controllers/memory/settings, journal pre-/post-hashes, then enable **both** the global and G1->G2 release switches for their intended exact canisters. The current generic `private_club_name_display` scope alone does **not** turn on the new global flags.
5. Confirm Test can see Test3, all existing child names remain unchanged, all teams in two distinct clubs inherit their respective club keys, and an outsider/revoked member cannot read ciphertext or obtain a club key. Collect cycle and latency comparison; shared vetKeys do not by themselves remove the historical `CIPHERTEXT_TIMEOUT`.
6. Only then set repository variable `IGNITE_DEV_SHARED_CLUB_NAMES_RELEASE_READY=true` and run the existing DEV frontend deployment. Roll back frontend by setting the variable back to `false` and redeploying DEV if acceptance fails. Backend changes require their own protected restore procedure.

## Execution status

The new read-only governor coverage audit is available in source, but full encrypted-copy coverage cannot be attested until the separately approved DEV G1/G2 PII reader modules have been installed and the check has run. A dedicated PII reader-only upgrade scope is prepared and does **not** activate either backend release switch. Running the generic upgrade now could break name access or leave the new policy inactive. Do not equate a green compile, a green upgrade, or PR #1566 merge with completed live all-club encryption enforcement. This document deliberately captures the fail-closed release boundary.
