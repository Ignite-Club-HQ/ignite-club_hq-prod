# PROD cycles top-up planner (read-only)

`[PROD] Plan cycles top-up (read-only)` computes the exact per-canister cycle
amounts needed to bring every registered PROD group service to its registered
minimum, so funding decisions rest on live balances rather than estimates.

## What it does

1. Reads the bounded consensus group registry page from the PROD shard router
   (governor-signed, read-only infrastructure reader).
2. Reads every group service's `cycles_balance` anonymously (public query).
3. Reads the signing account's cycles-ledger balance (`icrc1_balance_of`,
   anonymous query on `um5iw-rqaaa-aaaaq-qaaba-cai`).
4. Prints a per-canister table — balance, target (group minimum plus an
   optional reserve), exact top-up — plus totals, the signing account's
   coverage or shortfall, and a stable plan hash.

## What it never does

- No deposit, no funding order, no card link, no configuration change.
- No DEV access, no database access; groups stay closed.
- An unreadable balance is reported as unknown and excluded from totals —
  never treated as zero and never turned into an inferred payment need.
- The printed total is exact execution fuel from live balances, **not a
  payment quote**: card fees and price are set by the funding provider at
  checkout.

## Running it

1. Promote the tooling: `[REPO] Promote ICP canister code to the live
   repository` on `main`, mode `apply`, overwrite differing files.
2. On branch `prod`, run `[PROD] Plan cycles top-up (read-only)`. Leave the
   reserve input at `0` for the exact registered minimum, or enter a cycle
   count to plan a margin above it.
3. Read the Summary table; the same plan is in the `prod-cycles-topup-plan`
   artifact as JSON.

The plan hash binds the inventory, targets and amounts (not the observation
time), so a later top-up step can re-verify exactly what was reviewed.

## After the plan

Any actual top-up is a separate, separately approved step. The routing gate
(`[PROD] Check PROD routing gates (read-only)`) still governs readiness;
fuel alone does not close it.
