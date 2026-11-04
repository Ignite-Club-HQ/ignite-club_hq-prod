# Safe-only database release staging

The existing `[DB] Promote to Prod` workflow now has a manual **safe-plan** mode.
It verifies every original source against `safe-release-manifest.json`, reads the
live migration versions using a read-only connection, and checks only pending
candidate SQL with the unchanged structural parser. The report distinguishes
held originals from candidates; it never marks held SQL applied.

Manual runs default to safe-plan. PROD pushes retain the existing complete-plan
release gates; no automatic unsafe-original exclusion was added. The source-tests
job validates the complete manifest offline on pull requests and pushes.

Six initial candidates remain: profile country structure, welcome-message helper,
ladder visibility structure, event duty-team structure, competition-admin inbox
helper, and the separate signup-invite check. None is approved for execution by
this manifest. The anonymous routing read policy, media-maintenance helpers and
profile visibility helper replacements stay held for independent permission or
dependency review, despite passing the SQL parser.

## Still required before a live safe-only application

1. Read the exact target definitions, effective grants and trigger dependencies
   for each candidate, and review differences against the unchanged PROD objects.
2. Rehearse the exact target-specific structural SQL, including representative
   existing signup triggers. Do not infer compatibility from the parser alone.
3. Approve the exact target-bound release and its application mechanism. No
   selective executor is enabled yet: safe-plan deliberately stops before writes.
   Do not filter the Supabase migration tree, repair its ledger, or replay applied
   originals. A successful diagnostic job is not a successful database deployment.

No database, edge-function, scheduler, hosting or canister deployment was made
while implementing staging. Existing migration files and protected hashes remain
unchanged.