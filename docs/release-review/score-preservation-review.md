# Score / History preservation preparation

## Implemented offline

`scripts/score-history-reconciliation.mjs` accepts explicit match/source snapshots in memory. It has no CLI, database connection or mutation path. It accounts for every source, keeps before-images including orphans/conflicts, preserves zero and NULL separately, normalizes away-side scores only when the explicit team anchor matches, and never selects a “latest” winner. External fixture IDs require tenant/source binding. Duplicate identities and malformed scores fail closed.

The report always says `deploymentAuthorized: false` and `dataClearingAuthorized: false`. Consistent synthetic input is not approval or evidence of production completeness. Partial pairs stay partial; separate partial rows are not merged.

`score-shadow-schema-draft.sql` sketches a private, service-only shadow table with explicit grants/RLS and no cascading match FK. It remains outside migrations. No backfill, read API, existing trigger/policy/FK, live score or hide setting is changed.

## Still required before score implementation is complete

- Exact target adapter from match/event/History rows into these inputs, including preserved anchors after deletion and reassignment; no real application records have been exported or reconciled.
- Period-score orientation and detailed score-bearing player/stat/notes handling; the current core handles aggregate score pairs only.
- Target-specific private score storage and authenticated read/write DTOs, raw REST protection, summaries/reports/stats/ladder coverage.
- Preservation of richer fixture sync, event IDs and external override rules through schedule/team changes.
- Isolated representative target SQL rehearsal and independently approved exact backfill/coverage/conflict resolution before any plaintext clearing.

The ninth feature draft remains a held design and is still excluded from compiled adaptations. No production release, scheduler change or migration-ledger repair is authorized.