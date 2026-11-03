# PROD member-access gap review — 3 Nov 2026, 08:07 UTC

Read-only evidence only. Source: `[PROD] Check PROD routing gates (read-only)`
run 7 (`check-prod-routing-gates.yml`), branch `prod`,
https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/41600725574.
No setting, group, key, service, database, scheduler or business data was
changed. The check is read-only by construction and both groups stayed closed.

## What the live services actually reported

| Gap | Count | Meaning |
| --- | --- | --- |
| `ADMISSION_AUTHORITY_MISSING` | 24 | `IGNITE_ACCOUNT_SERVICE_IDENTITY` is absent on every admission-checking service; expected `wb3hl-byaaa-aaaai-ayeqa-cai`. |
| `REMOVAL_CHECKS_OFF` | 24 | Member admission is not enabled anywhere. |
| `PRODUCTION_ADMISSION_PATH_UNRELEASED` | 24 | The account service has not commissioned ordinary member access. |
| `CYCLES_BELOW_MINIMUM` | 4 | `base/club_domain`, `base/messaging_domain`, `g2/club_domain`, `g2/messaging_domain`. Measured shortfall 320,272,547,662 cycles. |
| `CLUB_BINDINGS_INCOMPLETE` | 2 | Both `club_domain` services hold an `identity_access` row that is not the PROD account service. |
| `DELETION_RELEASE_UNVERIFIED` | 1 | Bound-deletion protocol does not read back as released. |
| `ROUTING_APPROVAL_MISSING` | 1 | Expected: no opening approval may be recorded while any item above is open. |

The receipt at `prod-group-setup/identity-link.json` reads `phase: linked`
with no pending intent, while the live readback reports bound deletion as not
released. The live readback governs; the receipt is historical evidence only.

## Why the existing switch-on tool cannot be reused

`protectionEnvironment()` in `scripts/prod-protection-policy.mjs` always writes
`IGNITE_ACCOUNT_ADMISSION_RELEASE=1` **and** `IGNITE_ACCOUNT_REMOVAL_RELEASE=1`.
The simplified launch needs admission only, with global removal and erasure
staying deferred, so that tool cannot deliver this state. A separate
admission-only delivery path is required.

## Why the live services cannot be commissioned yet

`authorize_production_member_access`, `member_readers` and the
`ordinary_member_access` readiness row do not exist on the `prod` branch
(`backend/identity_access/src/lib.rs`, 5309 lines, no match). The live account
service therefore cannot accept a commissioning request until the reviewed
ordinary-access code is delivered to `prod` and the canister is upgraded.

## Delivery order this review implies

1. Deliver the reviewed ordinary-access account-service code to `prod`
   (add-only, upgrade-only; no data movement).
2. Correct both `club_domain` `identity_access` rows to `wb3hl-byaaa-aaaai-ayeqa-cai`.
3. Bind all 24 admission-checking services to the account service and enable
   member admission, with `IGNITE_ACCOUNT_REMOVAL_RELEASE` left absent and
   rehearsal left off.
4. Release bound deletion and re-verify the router authority and registry pin.
5. Commission ordinary member access as governor; read back
   `ordinary_member_access=true` and `global_account_operations_deferred=true`.
6. Top up the four short services (320,272,547,662 cycles measured, plus
   signing-account funds, fees and reserves, which this report excludes).
7. Re-run this read-only check; only then may an opening approval be recorded,
   followed separately by publication and a real production sign-in.

Steps 1-6 change live services and each needs Paul's explicit approval.
