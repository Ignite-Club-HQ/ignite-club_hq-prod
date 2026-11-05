# PROD cycles top-up: planner (read-only) and execution (closed)

`[PROD] Plan cycles top-up (read-only)` computes the exact per-canister cycle
amounts needed to bring every registered PROD group service to its registered
minimum, so funding decisions rest on live balances rather than estimates.

`[PROD] Execute cycles top-up (closed)` distributes exactly the reviewed
amounts from the signing account through the cycles ledger, behind the
reviewed plan hash and the `TOP UP PROD CANISTERS` confirmation.

## What the planner does

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

## Executing a reviewed plan

1. Run `[PROD] Plan cycles top-up (read-only)` on branch `prod` and note the
   plan hash in the Summary. The plan is also saved as a durable receipt at
   `prod-group-setup/cycles-topup-v2.json` in the live repository.
2. Run `[PROD] Execute cycles top-up (closed)` on branch `prod` with that
   plan hash and confirmation `TOP UP PROD CANISTERS`.

Execution properties:

- The entered hash must match the saved receipt, and the live inventory and
  targets must still match the reviewed plan — otherwise the run refuses and
  asks for a re-plan. Live balances drift down between planning and
  execution; the planned amounts drift with them and are recomputed from the
  live balances, capped at the reviewed amounts.
- Each deposit is capped at its reviewed amount: a canister that gained fuel
  since planning receives only the remainder; one already at target is
  skipped. Nothing ever receives more than reviewed.
- Every deposit is preceded by a durable acknowledged intent carrying its
  ledger dedup timestamp. If the runner is interrupted, a resume reuses that
  timestamp, so a deposit that already landed comes back as a ledger
  Duplicate and is recorded — never paid twice. An intent older than the
  ledger's 24-hour dedup window stops for manual reconciliation.
- Each deposit is the cycles ledger's `withdraw` call, which puts cycles into
  the canister's own cycle balance. The canister is read immediately before
  and after; if its balance did not rise by the amount (minus at most 1B
  cycles of normal burn) the run stops after that ONE canister. A final
  pass reports any canister still below its registered minimum.
- The run makes no registration, opening, configuration, funding-order, DEV
  or database change. Groups stay CLOSED; routing approval and admission
  remain separate reviewed steps.

## Incident 1 Nov 2026: misdirected first run

The first execution used `icrc1_transfer` to each canister principal. That
moved 6.948T cycles (plus 26 x 0.1B fees) from the signing account into 26
cycles-ledger accounts owned by the canisters, but did not raise any
canister's fuel; verification then stopped the run. The cycles are not lost
but are only movable by each canister itself calling the ledger's `withdraw`,
which no group service can do today. Its receipt
(`prod-group-setup/cycles-topup.json`) is kept untouched as evidence. The
planner now reports these as "held on canister-owned ledger accounts", never
as fuel. Reclaiming them needs a separately approved canister upgrade.
