# Reported full-suite failure repairs — 4 November 2026

Scope: local/DEV test repairs only. No production deployments, database changes, canister upgrades, permissions or live data writes.

## Reproduction and corrections

- NotificationListCard: reproduced all four failures in both modes. NotificationMessageText now uses React Query, but the card tests omitted QueryClientProvider. Added a fresh provider per test without mocking the actual card or message renderer. Also exercised mark-as-read, enabled/disabled approve/deny, card open and keyboard delete callbacks.
- Pending inbox preview: reproduced the newer-remote test failure in both modes. The pending send used the current date while the supposedly newer remote fixture used 28 October. Fixed the test clock at 28 October 23:00 UTC, before the remote 23:59 UTC message. Timestamp precedence in application code is unchanged.
- Photo storage contract: reproduced the exact-method-list failure in both modes. The current Candid binding includes read_account_protection_configuration, which the expected list omitted. Added that existing method to the expected contract; upload signatures and consensus/query assertions remain unchanged. No service code changed.
- EventGroupsManager: the reported two failures were not reproduced. Existing tests already pass: Supabase 13 passed/7 skipped; ICP 7 passed/13 skipped. Kept its source and tests unchanged; this is verification, not a claim to have repaired an unobserved failure.

## Verification

The same three-file pre-edit reproduction failed with six tests in each mode. After the repairs, all four reported-area files pass:

| Run | Files | Tests passed | Mode-specific skips |
| --- | --- | --- | --- |
| Supabase reported areas | 4 passed | 40 | 7 |
| ICP reported areas | 4 passed | 34 | 13 |
| Supabase related regressions | 43 passed | 450 | 23 |
| ICP related regressions | 43 passed | 425 | 48 |

Related regressions include notification repositories and requester text, inbox reconciliation/read models/pending and confirmed previews, blob upload/protocol/media resolution/sharding, and event group sync/map/assignment tests.

Preview build telemetry reports build OK after the edits. Non-failing test warnings include missing dependency sourcemaps and suspended-resource act timing; simulated permission-denial logs are expected coverage.

The entire approximately 900-file suite was not rerun in this repair batch. These results do not certify a fully green complete release suite or authenticated hosted/device acceptance. Production remains unchanged.