# Group 2 account linking — release readiness (12 November 2026)

## Verified problem

Using Ignite DEV and a signed-in Test account:

- `identity_access.whoami()`: active registered Test account.
- Group 2 `create_club` and `save_team`: succeeded using creator placement.
- Group 2 `read_account_my_role_grants()`: club_admin confirmed.
- Group 2 `read_account_whoami()`: `Err("Unlinked identity")`.
- Group 2 `sync_my_linked_account()`: `Err("Service admission not released")`.

No new club or team is required to resolve this; preserve the original identifiers.

## Root cause (two separate release gates)

In `backend/club_domain/src/main.mo`, `sync_my_linked_account` calls the shared identity's `read_linked_account` as **the Group 2 club canister**, not as the human user.

In `backend/identity_access/src/lib.rs`, `read_linked_account` selects `production_service_account` when rehearsal mode is off. It reads the account only when either:

1. `group2_admission().member_access` is commissioned and the exact group club reader is verified against the live pinned registry, or
2. the independent signed production account-reader approval is present, fresh, explicitly covers this club canister, and passes recovery/witness checks.

The legacy `authorize_group2_admission` method only authorizes **eligibility readers**. Its `account_admission_released=true` evidence does not assert `ordinary_member_access=true`, and neither proves `sync_my_linked_account` succeeded. The Group 2 repair workflow is therefore **not a complete fix** for linked-account sync.

## Safe release plan

1. **Read-only inventory first:** obtain governor-authorised `identity_access.read_group_opening_configuration()`, exact two-group router registry, verified current controller identities, module hashes, installed environment, cycles and matching bindings. Record both `account_admission_released` and `ordinary_member_access`. The human Test identity cannot use the governor-only read.
2. **Review the real prereqs:** check `IGNITE_ACCOUNT_SERVICE_IDENTITY` is exactly the shared identity authority on every applicable service, and `IGNITE_ACCOUNT_ADMISSION_RELEASE=1` where supported. Keep `IGNITE_ACCOUNT_REMOVAL_RELEASE` and all `LOCAL_REHEARSAL` flags off; preserve deletion controls. Do not change an identity binding of a nonempty group without a security/migration review.
3. **Select and approve one service-reader release:** prefer the already-developed `authorize_production_member_access` path only after its exact *closed two-group* registry, verified admission-only receivers, governor, pinned identity and bound-deletion preconditions are demonstrably satisfied. The current DEV Group 2 is **accepting new clubs**, which may cause this commissioning path to refuse; do not force it closed or repin live routing solely to satisfy the script. Otherwise use the independently signed production-reader capability with its full audit/recovery/witness requirements, or develop a separately reviewed narrow live-open group path. An admin approval alone cannot skip code gates.
4. **Controlled deployment:** only after CI, explicit security review, original-state snapshot/recovery confirmation and protected governor credentials. Journal each change. Never install/reinstall canisters, replace keys, bypass rejection codes, or blindly retry an unknown update result.
5. **Acceptance:** sign in through the existing TEST Internet Identity. Invoke `sync_my_linked_account` once, then `read_account_whoami` and `identity_access.whoami`; the same nonempty `account_id` must appear. Confirm the previously created club's administrator grant and team remain intact. Check unrelated principals, suspended/erased users and unrelated groups cannot acquire access.

## Changes on this branch

- `group2AccountLinkReadiness` is a pure, fail-closed classifier.
- The `[TEST] Repair Group 2 account access` workflow includes regression tests.
- The repair's status report explicitly records `accountLinkVerified=false` until a separately authenticated signed-in readback proves the opposite.
- This PR does **not** commission ordinary member access or change the live account service. It is safe to merge independent of the planned release.

## Decision

**Do not call the repair a completed account-link fix.** The next release needs either fully commissioned ordinary member access or a valid independent signed reader authorisation, followed by Test-identity readback.
