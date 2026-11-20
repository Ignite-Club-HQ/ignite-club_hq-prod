# Supabase failure resolution — 20 November 2026

The fresh complete configured Supabase application suite passes with the existing corrections from the ICP failure-resolution work. No further application changes were necessary.

## Results

- Tests: **8,021 passed, zero failed, 387 skipped** (8,408 total).
- Files: **1,001 passed, 9 skipped** (1,010 total).
- Runner exit code: **0**.
- Duration: **965.02 seconds**.
- Recorded start: 2026-11-20T06:45:16.982Z.
- Recorded finish: 2026-11-20T07:01:22.872Z.

Command from the project root:

```sh
node frontend/scripts/run-tests-recorded.mjs --backend-mode=supabase --output-dir=docs/testing/supabase-failure-resolution-2026-11-20 --maxWorkers=8
```

`summary.json` records runner completion and exit status; `supabase.log` retains the complete test output. Expected negative-path test logging is not a test failure.

## Previously failing tests

The four `events.listDedup.test.ts` failures were resolved in the preceding ICP repair by mocking the current `read_account_list_events` actor method rather than the obsolete `list_events` method. They pass in this complete Supabase run, as does the corrected asynchronous administrator page test.

## Scope and limits

This is the complete configured mocked application suite in Supabase mode, not a live authenticated Supabase acceptance check. Existing exclusions and 387 skips remain unchanged. Supabase function tests were not rerun in this request; the prior reported result was 81 passing. No database migrations, role changes, deployments, running DEV changes, or PROD operations occurred.