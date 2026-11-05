# PROD account-service lifecycle link — closed groups

This gate links the PROD account service (`identity_access`) to the reviewed closed router deployment. It is one part of DEV-equivalent PROD setup, not full completion, and it does not open a group.

Three effects, applied in this order and each read back before the next:

1. `IGNITE_BOUND_DELETION_RELEASE=1` on the account service (merged over its existing environment, never replaced wholesale);
2. the router's deletion authority bound to that account service;
3. the account service's trusted deletion registry pinned to that router at its live registry revision.

It never registers or opens a group, never records a routing approval, never enables admission or rehearsal, and never touches DEV, funding, deployments or the database.

## Owner runs

Promote the tooling first: **`[REPO] Promote ICP canister code to the live repository`** on branch `main`, mode `apply`, with **Overwrite live files that differ** checked.

Then **`[PROD] Link account service lifecycle (closed)`** in the live repository, branch **prod**:

- Action **plan** — reviewed-plan hash and confirmation left empty. Read-only: it records a hash-bound plan on the `prod-group-setup-receipts` branch and prints the hash.
- Action **link** — the exact hash from that plan, confirmation **LINK PROD ACCOUNT SERVICE**.
- Action **inspect** at any time — read-only receipt and live state, no writes.
- Action **reconcile-readback** — only for an interrupted run; it completes the final readback and repeats no write.

Do not run any other workflow between `plan` and `link`: a code copy changes the source commit and correctly makes the reviewed hash stale.

## What must already be true

- Both `base` and `g2` are registered CLOSED and still match their reviewed receipts, with one approved subnet and the reviewed public-mainnet PROD placement.
- The router has no deletion authority, or it already points at this account service.
- The account service is unpinned, or already pinned to exactly this registry and deployment.
- `IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL` is absent or `0`.

Any other state stops for review instead of substituting a binding.

## Known gates this leaves open

Recorded here so a later opening run is not surprised. None of these are changed by this gate.

- **Routing approval** is still missing and must be recorded against the router's *current* configuration revision. `set_deletion_authority` bumps that revision, so approval must be recorded *after* this link, never before.
- **Admission reads demand a different deployment id.** `backend/identity_access/src/admission.rs` requires `binding.deployment_id == "mainnet"` for admission readers, while the PROD placements and this pin use `deployment_id == "prod"` (which `group_inventory::validate` requires to match the placements). Opening PROD therefore needs its own reviewed code/release decision — the pin must not be switched to `mainnet` silently, because that breaks inventory validation against the registered placements.
- **Club-domain identity wiring is separate.** `set_owner_test_deletion_identity` on a club domain requires that club domain's new-club placement environment (`IGNITE_NEW_CLUB_PLACEMENT_GROUP=g2` plus router and target), and DEV's base-group alternative (`link_display_identity_authority`) requires the rehearsal switch, which must stay off on PROD. So club wiring needs its own placement-settings gate first.
- **The pin is revision-bound.** `read_group_inventory_evidence` requires the pinned `registry_revision` to equal the live registry revision, so any *further* group registration invalidates identity evidence reads until the pin is advanced (substitution or rollback is refused by design). Both groups are registered, so no further registration is planned.
- **Bound-deletion release reads as `true` only while the environment variable is present**; a later settings write that drops it silently un-releases the protocol. This gate always merges rather than replaces.

## Evidence

Each run writes JSON to the `prod-identity-link` artifact: the planned receipt, the live state at plan time (`prod-identity-link-plan.json`), and the live state after linking (`prod-identity-link-linked.json`), plus a bounded failure report naming the stage. The durable receipt lives at `prod-group-setup/identity-link.json` on the `prod-group-setup-receipts` branch.
