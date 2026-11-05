# Safe-only database release staging

The existing `[DB] Promote to Prod` workflow now has a manual **safe-plan** mode.
It verifies every original source against `safe-release-manifest.json`, reads the
live migration versions using a read-only connection, and checks only pending
candidate SQL with the unchanged structural parser. The report distinguishes
held originals from candidates; it never marks held SQL applied.

Manual runs default to safe-plan. PROD pushes retain the existing complete-plan
release gates; no automatic unsafe-original exclusion was added. The source-tests
job validates the complete manifest offline on pull requests and pushes.

The inventory is 45 sources: 11 candidates and 34 held originals. Six candidates
are owner-approved for execution in `safe-apply-approval.json` — the signup-invite
check, competition fixture visibility, competition Vault manager access, official
email invitations, club invitation message defaults, and the one-time welcome
direct message. The anonymous routing read policy, media-maintenance helpers and
profile visibility helper replacements stay held for independent permission or
dependency review, despite passing the SQL parser.

## Owner-reviewed structural findings

The structural parser deliberately flags any query or helper-function call that
appears outside a stored function body, because a policy expression or constraint
can reach data at release time. That is the correct default, so the parser is not
weakened. Instead an owner-signed ledger,
`safe-apply-reviewed-findings.json`, records the exact finding text on the exact
fingerprinted file it was reviewed for, with its occurrence count.

- A finding the ledger does not carry stops the release.
- Editing a reviewed file changes its fingerprint and invalidates its review.
- A ledger entry for a file nobody approved, or for the wrong target, is rejected.
- A review that undercounts occurrences stops the release.

Five findings are recorded: the fixture-visibility policy helper, the invitation
token length check and admin-lookup policy on the email-invite batch, and the
membership subqueries in the invitation-defaults policies.

## Still required before a live safe-only application

1. Read the exact target definitions, effective grants and trigger dependencies
   for each candidate, and review differences against the unchanged PROD objects.
2. Rehearse the exact target-specific structural SQL, including representative
   existing signup triggers. Do not infer compatibility from the parser alone.
3. Approve the exact target-bound release and its application mechanism. Safe-apply
   executes only fingerprint-matched approved files. Do not filter the Supabase
   migration tree, repair its ledger, or replay applied originals. A successful
   diagnostic job is not a successful database deployment.

No database, edge-function, scheduler, hosting or canister deployment was made
while implementing staging. Existing migration files and protected hashes remain
unchanged.