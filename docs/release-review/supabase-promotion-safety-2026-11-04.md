# Supabase promotion safety — 4 November 2026

## Conclusion

The currently approved database-only batch is narrow and regression-tested. This
does **not** establish that merging and publishing the entire new frontend will
leave every existing production feature working. Earlier blanket “clear to merge”
statements should not be used as a full-app compatibility certification.

No PROD deployment, account creation, settings update or data write was performed
in this review. Workspace database access remains DEV-only.

## Verified locally

- The checked-in approval selects exactly the fingerprinted November 4 separate
  email signup trigger, not the old replacement of `handle_new_user`.
- Release/source/publication tests: 41 passed.
- Browser-policy unit tests: 42 passed. The actual `isEmailAuthAllowlistActive`
  implementation requires a nonempty list; missing/empty settings do not arm it.
- New `scripts/signup-approved-rehearsal.test.mjs`: passed against the exact
  approved SQL in a disposable, socket-only PostgreSQL 16 database. It inherits
  no hosted credentials and connects to neither DEV nor PROD.
- That rehearsal verifies existing account updates remain allowed; the existing
  profile helper and both AFTER triggers retain their definitions; eligible
  invited email signup and non-email signup succeed; uninvited email signup is
  refused with the switch armed; missing and empty settings permit signup; account,
  profile and claim counts remain consistent; helper is not callable by anon or
  authenticated users.
- The new rehearsal runs in the workflow's source-tests job before deployment.
  It tests database behavior, **not** real hosted login or password reset.
- Default safe-apply returns before any edge-function deployment. Other sources
  remain held; no score, club-country backfill, job or bucket changes are approved.

## Unverified production facts — do not infer them from catalogs

1. The live `backend_routing_config` row values. Both owner exports were catalog
   only. They cannot prove the email-club list is absent/empty. Do not promise
   the new trigger is dormant without this check.
2. Current hosted signup/provider settings and real existing-member email login.
3. Current invite RPC result shapes and end-to-end invited signup on PROD.
4. Exact live trigger state immediately before applying the migration. Saved
   November 4 evidence supports compatibility, but is not a continuous live check.

## Full frontend promotion has known dependency gaps

The expanded PROD export reports missing objects used by the new frontend:

| App path | Missing PROD dependency | Release impact to resolve |
|---|---|---|
| Competition fixture visibility | `get_my_viewable_competition_match_ids` | Do not assume fixture/score reads work; score migration remains held. |
| Competition document access | `can_access_competition_vault` and related access functions | Do not weaken access checks; verify authorized document reads. |
| Official email invitations | `create_competition_role_email_invite` and email-invite table/functions | New email invitation action cannot be assumed to work. |
| Club invitation defaults | `club_invite_message_defaults` | Default-message reads/saves require missing table/policies. |
| New-member welcome | `send_welcome_dm` | Optional message remains absent until separately approved. |
| Admin memory reporting | `canister_memory_reports` | Diagnostics unavailable; not a core login dependency. |

These are confirmed call sites and catalog absences, not all reproduced runtime
failures. ICP routing may avoid some Supabase calls; retained email clubs still
need their real Supabase paths tested. A successful database deployment job alone
does not certify those paths.

## Minimum next steps

- Keep the approved database batch unchanged; do not bulk-approve missing features.
- Before claiming dormant signup behavior, obtain an authorized bounded read of
  the PROD routing row (email-club IDs/status only; no unrelated settings/secrets).
- Resolve or intentionally keep unavailable the listed new frontend actions using
  the saved follow-up checklist; preserve existing working reads and permissions.
- Before full-app publication, test one existing email-club member through login,
  club/team, chat, fixtures and authorized documents in the actual target setup.
  Authenticated PROD verification is unavailable from this workspace.
- After Paul's merge, inspect the successful deployment/report for that exact
  commit. No live deployment was triggered here.