# Auth-only exact staging and production comparison

## Prepared on 30 October 2026

`node scripts/auth-exact-staging.mjs` creates a new temporary offline workspace containing only:

- `candidates/01_signup-helper.sql`
- `candidates/02_signup-access.sql`
- `manifest.json`

Both SQL files are exact reviewed draft copies. Their bytes, owner-intent record, saved smaller review and all three production-evidence records are pinned in the builder. All **38** original migrations remain in the source inventory and absent from the workspace. Nothing applies SQL, connects to a database, repairs history, arms routing or enables a workflow. Owner approval remains scope intent, not a deployment grant.

The generated package is an exact **rehearsal staging artifact**, not the production runner's pending migration plan. Existing runner and publication holds are unchanged. Target collision checks, effective routing access, authoritative invitation lifecycle and hosted acceptance remain required. Profile creation and both existing account AFTER triggers stay untouched by the candidate drafts; local synthetic lifecycle tests verify this boundary, not real hosted Auth settings.

## Exact production-source comparison

Fresh read-only GitHub branch inspection confirms PROD remains at `ea005b7178a6de9c207b744a2ea65cffde713b5f`. Its public source archive was fetched and inspected under `/tmp`, excluding environment files and repository metadata. Archive SHA-256: `a7b78e4acfa6d1023ac1ca0d670ef59ec046037f720f98062f2aa8e48cc9c46a`.

`auth-source-closure-2026-10-30.json` fingerprints the entire extracted production source and conservatively scans the current app's auth entrypoints, provider and application shell, resolving the existing TypeScript aliases. It identifies 1,534 reachable files: 607 absent in production, 555 changed and 372 byte-identical, with zero unresolved literal imports. These numbers include the application-shell graph; **they are not a release size or copy list**. Runtime-computed imports and semantic routing behavior need manual review.

The exact baseline has Supabase auth, including Google sign-in machinery, but no `src/live/` ICP infrastructure or Placement Settings page. Current secure sign-in cannot be ported merely by copying a tab or the complete current provider. An II principal does not authorize the old Supabase-only club pages. Current shared provider/routing changes also affect notification and score paths, even where score-page bytes are unchanged.

## Concrete selective integration boundary

1. Retain the production `App.tsx`, boot, Supabase provider, score/History paths and notification lifecycle as the baseline.
2. Port only invitation-token extraction, pre-signup UX validation and token metadata into the existing production signup method; use a narrowly scoped settings reader rather than wholesale backend routing. Adopt the separate private SQL guard only after target reconciliation.
3. Add the public tabs only with a working secure provider and defined post-login ICP club boundary. Integrate redirect completion without replacing production notification/OAuth boot.
4. Preserve current administrator permissions; do not transplant the full engine/placement settings page as a small email-list editor. Review only the retained-email setting and preserve other configuration properties.
5. Remove actual club names from the public signup-denial message in the selective source patch. Current DEV `emailSignupPolicy.ts` still contains named-club copy; this must not ship unchanged. Do not point users to an unavailable secure option.
6. Pin a reviewed selective patch, its package/build dependencies, callback origins and PROD canister configuration. Verify that production scores and pushes still read/write their original services.

## Remaining gates

The database draft packaging is prepared; selective secure-provider/post-login integration is not yet assembled or accepted. It is an engineering dependency, not another score-reconciliation prerequisite. Independently authorized current target inspection, hosted signup/confirmation/admin checks, Netlify/Codemagic settings and phone notification acceptance remain unavailable in this environment.

No production merge, branch creation, publication, function deployment, permission change or scheduler action was performed. Score/AI work remains deferred.