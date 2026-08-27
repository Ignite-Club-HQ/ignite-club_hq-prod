# One-click baselines

The baseline commands always work in a disposable directory under the system temporary folder. They do not change, stage or commit files in the active workspace.

## Full reconciled codebase

```bash
npm run baseline
```

Equivalent explicit command:

```bash
npm run baseline:full
```

This checks out `promotion/09b-telemetry-recipient-reconciliation` and runs every applicable gate found there: production and strict TypeScript, the 5,000+ Vitest suite, matrix tests, Playwright journeys, production build, Android and iOS isolated harnesses, and Edge-function Deno tests.

Override the aggregate ref when a newer reconciled aggregate is created:

```bash
BASELINE_AGGREGATE_REF=promotion/10-reconciled npm run baseline:full
```

## One tranche against current main

Pass a tranche number:

```bash
npm run baseline:tranche -- 00
npm run baseline:tranche -- 03
```

Or pass its full branch name:

```bash
npm run baseline:tranche -- promotion/05-messaging-notifications
```

The runner creates a disposable candidate from `main`, merges only the selected tranche, and runs every applicable gate available after that merge. A merge conflict or failed gate makes the command exit non-zero. Override the base when validating the next tranche after earlier tranches have been merged somewhere other than `main`:

```bash
BASELINE_BASE_REF=my-validation-base npm run baseline:tranche -- 02
```

## Optional local database integration

Local Supabase tests are intentionally opt-in because they require an isolated running local stack:

```bash
npm run baseline:full -- --include-local
npm run baseline:tranche -- 03 --include-local
```

The runner never supplies hosted Supabase credentials. The candidate's local test safety guards remain authoritative.

The runner reuses the repository's installed dependencies only when the package locks match. Otherwise it installs the candidate's exact lockfile. For an intentional diagnostic-only override, set `BASELINE_REUSE_NODE_MODULES=true`.

Use `--keep-workspace` to retain the disposable candidate for investigation after a run.

The older push-queue-only baseline remains available as:

```bash
npm run baseline:push-queue
```
