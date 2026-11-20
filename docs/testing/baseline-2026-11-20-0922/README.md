# Baseline rerun — 20 November 2026

Both complete configured application suites finished successfully on the same source checkout, with independent summaries and full logs preserved here.

| Suite | Passed | Failed | Skipped | Exit code |
| --- | ---: | ---: | ---: | ---: |
| Supabase application | 8,021 | 0 | 387 | 0 |
| ICP application | 7,643 | 0 | 765 | 0 |
| Supabase functions | 81 | 0 | 0 | 0 |
| Rust workspace | 372 | 0 | 0 | 0 |

Supabase application: 1,001 files passed, 9 skipped; started 09:23:34.517 UTC, completed 09:45:16.788 UTC, duration 1,301.20 seconds.

ICP application: 1,002 files passed, 8 skipped; started 09:23:34.520 UTC, completed 09:45:14.954 UTC, duration 1,299.35 seconds.

## Commands

Run from the project root (the two application commands ran concurrently):

```sh
node frontend/scripts/run-tests-recorded.mjs --backend-mode=supabase --output-dir=docs/testing/baseline-2026-11-20-0922/supabase --maxWorkers=12
node frontend/scripts/run-tests-recorded.mjs --backend-mode=icp --output-dir=docs/testing/baseline-2026-11-20-0922/icp --maxWorkers=12
cargo test --workspace --locked -- --test-threads=1
deno test --node-modules-dir=none --allow-env --allow-read=supabase/functions --no-check supabase/functions
```

## Evidence and limits

- Each application directory contains its completed `summary.json` and full test log. Rust and function logs have corresponding exit-code files.
- The first function attempt failed before execution because Deno searched the dependency-free root for an npm dependency. The second ran 80 passing tests but one source-inspection test lacked read permission. Both attempts are preserved; the final scoped-read rerun passed all 81. No source or dependency configuration changes were needed.
- These are configured local/mock baselines, not authenticated live-service, physical-device, deployed-canister or full replica acceptance. Existing configured exclusions and mode-dependent skips were not changed. Function tests used `--no-check`, so this is not a Deno typecheck result.
- The interrupted 07:09 baseline remains historical incomplete evidence and is superseded by this completed rerun.
- No application code, live DEV/PROD settings, business data, migrations, controllers or deployments were changed.