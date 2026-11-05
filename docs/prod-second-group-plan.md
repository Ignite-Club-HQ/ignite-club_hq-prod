# Independent PROD second group: review and funding estimate

The base group is registered closed. This step prepares a second independent
group matching DEV's architecture, without copying DEV IDs, identities or data.

## Owner's next run

1. Copy the new tools using **[REPO] Promote ICP canister code to the live repository**,
   branch **main**, mode **apply**. Allow reviewed differing tooling files as needed.
2. In the live repository, start **[PROD] Plan second group and funding (read-only)**
   on branch **prod**. There are no other inputs.
3. Review the Summary and `prod-second-group-plan` attachment before funding or
   approving creation. A successful run is a proposal, not setup completion.

## Estimate, not a spending grant

New g2 requires 12 independent domain canisters plus a dedicated photo store:
13 × (1.5T retained fuel + estimated 0.1T creation fee) = **20.8T cycles**.
The workflow reads the PROD governor's default Cycles Ledger account and reports
the current estimated shortfall. It does not invent a balance or dollar price.
Retained fuel remains in the new services; it is not a consumed setup fee.
Installation/configuration execution, ongoing storage/running costs and card
gateway pricing are additional. Exact current fees and an explicit total ceiling
must be approved before any paid mutation.

## Safety boundaries and remaining setup

- Read-only GitHub token; no receipt-branch creation, canister setters, CLI deployment,
  card order, transfer, registration, admission, database, publishing or DNS changes.
- Require registered-closed base receipt, complete base-only registry, certified
  18-service PROD inventory, sole PROD governor and exact single-subnet placement.
- Unknown/existing g2, unresolved receipts, changed base configuration or incomplete
  evidence stop the run. Health-only readings do not alter configuration bindings.
- The artifact binds current source, receipt, registry/configuration revisions,
  certified observations and own-account balance. It is explicitly non-executable.
- Closed creation/configuration needs a separate PROD-bound durable intent runner,
  reviewed build hashes and owner-approved spend ceiling. Never run TEST installation
  against PROD or transplant its DEV-generated bindings.
- Identity registry binding, router identity binding, supported exact bound-deletion
  verification and configuration-bound routing approval remain required. Keep PROD
  closed; this proposal cannot authorize lifecycle release or admission.