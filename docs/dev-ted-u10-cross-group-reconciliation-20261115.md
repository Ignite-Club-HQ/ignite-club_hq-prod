# DEV test: reconcile Ted from original Group 1 with U10 in Group 2

**Status: read-only preflight only. No data migration approved, executed, or offered in this PR.**
**Scope:** Test full access Internet Identity and the exact existing ChatGPT Plugin Test U10 DEV team. Both canisters are on **public ICP mainnet**, but these are the Ignite DEV group canisters.

## Verified evidence at review

| Data | Source of evidence |
|---|---|
| Parent Internet Identity | `edt5h-vbtif-a523i-cfe6i-ieemk-2ljzi-frngv-3vjyy-mxf3o-safv3-fae` — live connector principal |
| Group 1 child `child-own-3-12562284057` | Present, no team, primary Parent matches test account; user screenshot labels the second Group 1 card **Ted** |
| Other Group 1 child `child-own-2-838302582919` | Present and assigned to a Group 1 team; name shown as **Child** (not decrypted); **not in scope** |
| Group 2 | `yfwyv-nyaaa-aaaal-qxpyq-cai`; Parent membership on club `177f8c01-3617-402a-aedd-5c5c17ccfde1` and U10 team `a3e9341e-bc61-4e4d-9ebf-2f2c9f347128` |
| Destination child list | Zero in the Parent's Group 2 account at latest readback |

Screenshot identification is not a cryptographic name proof. The read-only browser preflight re-reads the encrypted name from **Group 1's** PII service as the signed-in Parent and refuses to proceed unless it decrypts exactly to **Ted**.

## Read-only review (this PR)

1. As **Test full access** Internet Identity, on the pinned DEV web origin, open **My Children**.
2. The existing, specifically pinned Ted card has **Review U10 move**. Clicking **Review** calls *only* existing caller-authorised reads.
3. The browser checks the exact Group 1 canister and child ID; current principal is the primary Parent; decrypted name is `Ted`; the only guardian is that Parent; Ted has no Group 1 team.
4. Separately, it verifies U10's team ID, name, club ID, actual Group 2 canister, current Parent membership, and that this Parent has no Group 2 children.
5. The result is explicitly `writeAuthorised: false`. No child is added, renamed, relinked, copied, deleted or transferred. If any read fails, name cannot be decrypted, or evidence changes, the preflight refuses.
6. The My Children team picker now gathers the signed-in user's roles *inside each group* via `read_account_my_role_grants`, so Group 2 U10 should be discoverable without accidental Group 1 targeting.

## Why the existing app cannot perform a true child transfer

- `club_domain.create_own_child()` always generates a **new** child ID in its own canister, and there is no single-child import/move method.
- `club_domain.set_own_child_team(childId, teamId, true)` only finds the child and team **within the same club_domain canister**. A Group 1 child cannot be assigned to a Group 2 team with it.
- The child's name is encrypted in the source group's `pii_access_control`, not present in the `club_domain` child record. Copying raw encrypted bytes across groups is not a supported substitute for explicit caller-authorised destination encryption.
- Full club snapshot import/export handles **club-wide** transfer and fencing; it is inappropriate for an unassigned Parent-owned child.

## Separate future owner approval and implementation required

For this DEV-only family test, a **staged re-creation with an explicit source→destination mapping** is possible, but it creates a *new* Group 2 child ID, not a true identity-preserving transfer. It must be described as such, never silently presented as the original record moving.

An executable follow-up would need, in this order:

1. Exact fresh source/target preflight, including a separate owner-reviewed *write* authorization naming the exact source child ID and U10 target. Verify any extra guardians, dependent event/RSVP/rewards/media references, other accounts, and the source PII state.
2. A durable, privacy-safe receipt that binds Parent principal, source canister/child ID, target canister/club/team, intended release, and step status **before** the one non-idempotent create call. No plaintext name or Internet Identity secrets in receipts.
3. One Parent-signed destination `create_own_child()` call (only after explicit permission) and independent destination child-list readback. If return is lost, stop: **do not issue a second create**. Resolve the unknown outcome using the receipt and fresh group reads.
4. Register Ted's name via destination PII encryption; treat current `registerLiveChildNamePii` as best-effort, **not** proof of success. Read back/decrypt destination name and confirm parent/grants before team assignment.
5. One destination `set_own_child_team(..., true)` update and independent fresh checks of destination Parent child list, protected staff roster, and U10 name visibility; preserve links and detect partial failures.
6. Keep Group 1 source record, name, original family relationships and any attachments **untouched**. Separately review whether to retire the G1 record; never automatically delete or reassign it during the destination step.
7. Explicitly verify nothing changed in other Group 1 child, other canister groups, notification queue or PROD, and no notification was triggered.

**No step 3–6 implementation or live write is part of this PR.** A future PR should include PocketIC failure/unknown-outcome rehearsals and use an explicit operator approval before deployment or any live write. This safeguard is important because source and destination do not share a transaction boundary.
