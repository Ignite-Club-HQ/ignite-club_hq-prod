# PROD routing gate — read-only review

`[PROD] Check PROD routing gates (read-only)` answers one question: **is there
anything left to verify before a governor could record the PROD routing
approval?** It reads infrastructure only. It never records an approval, never
opens a group, never enables admission, never funds, deploys or touches DEV.

## How to run

1. Copy the tooling first: `[REPO] Promote ICP canister code to the live
   repository` on `main`, mode `apply`, with **Overwrite live files that
   differ** checked.
2. On branch `prod`, run `[PROD] Check PROD routing gates (read-only)`. No
   inputs are needed. Leave the run until it finishes; the report is printed to
   the log, written to the job Summary and uploaded as artifact
   `prod-routing-gate`.

The run exits non-zero while the gate is incomplete. That is the answer, not a
crash: a not-ready PROD must never look green.

## What it reads

For every registered group, from consensus and management replies signed by the
existing PROD governor:

- the bounded group registry page (groups, placements, configuration revision),
  plus the recorded routing approval;
- management `canister_status` for each of the twelve data services and the
  group-owned photo store: running state, controllers, cycles and environment;
- the certified subnet and installed module hash of each service;
- each service's own `read_group_opening_configuration` rows;
- the router's deletion authority and the account service's registry pin,
  bound-deletion release and admission-release state.

## What it reports

Every unverified item is listed, not just the first:

| Gap | Meaning |
|---|---|
| `GROUP_OPEN` | A group is accepting clubs; this gate is closed-only. |
| `PLACEMENT_INCOMPLETE`, `WRONG_TARGET`, `REGISTRY_TRUNCATED` | The registry or placement is not the exact PROD HTTPS/single-subnet deployment being approved. |
| `SERVICE_NOT_RUNNING`, `CONTROLLER_NOT_GOVERNOR`, `SUBNET_MISMATCH`, `MODULE_HASH_MISSING`, `CYCLES_BELOW_MINIMUM`, `HEAP_AT_BUDGET` | A service is not healthy, not solely governor-controlled, not on the group's subnet, or out of budget. |
| `REMOVAL_CHECKS_OFF`, `ADMISSION_AUTHORITY_MISSING` | A group service still admits everyone, or is not bound to the PROD account service, so removals are not enforced. |
| `WRONG_RECIPROCAL_AUTHORITY`, `CONFIGURATION_ROW_MISSING`, `CLUB_BINDINGS_INCOMPLETE`, `COMPETITION_AUTHORITY_MISSING`, `NOTIFICATION_IDENTITY_MISSING` | A service points somewhere other than its own group's services. |
| `PUSH_WORKER_UNPINNED`, `NOTIFICATION_WORKER_MISSING`, `TIMER_WORKER_MISSING` | The PROD delivery identity is not named or not granted. |
| `ROUTER_DELETION_AUTHORITY_MISSING`, `IDENTITY_REGISTRY_NOT_BOUND`, `DELETION_RELEASE_UNVERIFIED` | The account-service lifecycle link is not in place (that is `[PROD] Link account service lifecycle (closed)`). |
| `ADMISSION_RELEASE_UNVERIFIED`, `ACCOUNT_ELIGIBILITY_READER_UNAUTHORIZED` | The account service has not released account admission, or has not authorized a specific reader. |
| `ROUTING_APPROVAL_MISSING`, `ROUTING_APPROVAL_STALE` | No approval is recorded, or the recorded one does not match this configuration revision, configuration digest and group inventory. |

When nothing is outstanding, the report prints the exact approval a governor
could record — configuration revision, approved-configuration digest, the
complete group inventory and an evidence hash — and still states that recording
it is a separate, separately reviewed action.

## Standing limits

- The approved-configuration digest is computed with the same canonical text the
  shipped client compares, so an approval can never be wider than what clients
  accept. Runtime health and club counts are excluded; placement, identities and
  subnet bindings are not.
- Module hashes are read live; attestation against reviewed WASM stays separate.
- Group opening, admission release and routing approval are three distinct
  gates. Closing one never implies another, and this workflow performs none of
  them.

## Connection check and the second group

`[PROD] Check PROD canister connections` previously reported
`UNREVIEWED_GROUP_INVENTORY: g2` even after g2 registration, because the
reviewed inventory was never supplied to the readiness assessment. The check now
loads it from the acknowledged g2 registration receipt in the durable journal
(`prod-group-setup/g2-registration.json`) and only from there: a router reply
can never vouch for the inventory it is being checked against. If that receipt
is missing, unfinished or reuses a base canister, the flag stays and the reason
is printed instead.
