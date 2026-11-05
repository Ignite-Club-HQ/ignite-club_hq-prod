# Read-only production release evidence — 30 October 2026

## Scope and verdict

Paul approved proceeding with read-only PROD checks. All GitHub requests were GETs using Paul's GitHub API connection; no workflow, migration, phone notification, deployment or production write was initiated. Release remains on hold.

## Verified GitHub evidence

- Repository: `Ignite-Club-HQ/ignite-club_hq-prod`; default branch is `main`.
- PROD branch head: `ea005b7178a6de9c207b744a2ea65cffde713b5f`, merge #1410, 21 October 2026.
- That commit has a successful **Migrate + deploy backend** GitHub Actions check and a successful **Android Build (PROD)** Codemagic check. These are historical successes, not evidence that today's auth candidate or phone delivery works.
- Existing database runner: `.github/workflows/promote-to-prod.yml`, display name **Promote to Prod**. Run #511 completed successfully on PROD at the above commit: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/39557808427.
- Read the workflow from that immutable commit. A contents request for the same path on `main` returned 404; the local main source also lacks it. A merge of this main source would remove the existing database runner. The ICP promotion workflow is not its replacement.
- Classic PROD branch-protection request returned **Branch not protected**. Effective branch rules returned only a deletion rule, not required status checks or pull-request review. The source CI release hold is therefore not an enforced merge prohibition.

## Existing runner behavior requiring review

Line references below refer to the workflow source itself, excluding the two-line saved tool-response prefix.

- Triggers: pushes and pull requests targeting `prod`, plus manual dispatch (lines 34–39). CLI is pinned to 2.34.3. It links using the existing `SUPABASE_PROD_PROJECT_REF` secret; comments identify intended PROD as `yabcfiuntwqjwvschnji`. The actual secret value was not inspected.
- Lists linked migrations, but previews and scans changed files rather than the complete pending target inventory (lines 98–190). The guard strips `DO` bodies despite those executing during migration, so it is not complete destructive-change protection.
- DEV-only skips mark matching migrations applied and ignore repair failures (lines 241–263). This is ledger mutation, not a safe exclusion based on independently reviewed fingerprints.
- Orphan reconciliation reverts remote history entries missing local files, then deletes those ledger rows directly (lines 431–476). Do not run this automatically against the newer main inventory without explicit reviewed reconciliation.
- A legacy migration may execute through transactional `psql` and be marked applied before normal `supabase db push --linked` (lines 479–518). Every apply path needs the same complete ordered, hash-bound preflight.
- Push processing also touches extensions/Vault prerequisites, runtime dispatch credentials, cron callers and legacy trigger dispatch credentials (named steps in the recovered workflow). Restoring the workflow unchanged could modify existing production push infrastructure; present approval is read-only and does not authorize these actions.
- Manual dispatch is not a read-only evidence path: the storage-bucket ensure step explicitly runs on dispatch (lines 522–545). Do not dispatch this workflow to collect evidence.

## Database access boundary

`lovable supabase info` binds this session to `ecsdwrarzfexssxtrymj`, the owner-designated DEV database. Its generic `environment: production` label describes Lovable's connection slot, not Ignite's DEV/PROD separation. The project ref is decisive.

The database query tools have no alternate-project parameter. No PROD database credentials, managed PostgreSQL connection or Supabase management access token are available in this sandbox; no Supabase workspace connector appeared in the accessible connection list. Do not reconnect this DEV project to PROD or substitute DEV results for PROD evidence.

Consequently, current PROD migration ledger, account-creation function/triggers, routing policies/grants, club IDs and sign-in settings remain **unverified**. The approved bounded query pack in `docs/auth-prod-read-only-evidence.sql` was not executed against PROD.

## Next closure steps

1. Collect the bounded read-only evidence pack through the project already connected to Ignite Club HQ PROD, preserving this project's DEV connection. Return only requested catalog/configuration results, never users, invite tokens, credentials or unrelated settings.
2. Compare the independently verified target ledger with the complete main migration inventory and the recovered runner's ordered pending plan. Review exclusions/reconciliation before changing any ledger.
3. Prepare a DEV/repository-only restoration of the existing runner with complete preflight before all write paths; preserve existing production push behavior and do not silently authorize cron, credential or history rewrites. PROD merge-check enforcement needs separate GitHub settings approval.
4. Use the actual PROD profile-creation before-image to prepare separate signup authorization; review target-specific club activation and narrow signed-out access separately.
5. Complete release-candidate email/invitation and Android/iOS receipt/tap-through acceptance. Only then seek release and any ICP worker activation approval.