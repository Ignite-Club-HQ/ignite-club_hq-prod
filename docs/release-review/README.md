# PROD compatibility preparation — 30 October 2026

## Evidence and limits

The owner supplied a SQL Editor CSV. `prod-evidence-2026-10-30.json` records its SHA-256 and the selected catalog results, without accounts, invitation tokens or scheduler commands. The connection identity was not independently established by these results; attribution to PROD is owner-supplied, not a direct hosted read by this workspace.

The export contains 1,137 unique applied versions, ending at `20261029094707`. All 37 current migration versions are absent. `pending-plan-2026-10-30.json` fingerprints every current file, marks each held, and retains the six existing protected migration hashes. Version absence does not establish schema absence or semantic equivalence. This is an offline review inventory, not a deployable or approved plan.

Production's supplied `handle_new_user` inserts only the profile ID. Existing account triggers are `on_auth_user_created` and `trg_auto_claim_eois`. No invitation guard functions or routing settings row are returned. Settings policies permit authenticated reads, not anonymous reads; anon already has SELECT granted. Broader existing grants are not evidence that anonymous RLS access is allowed. Do not alter unrelated grants without a separate review.

The separately supplied scheduler results show both reminder jobs active, referencing `internal_service_role_key` through an authorization header. They do not establish credential validity or delivery. Keep current schedules and credentials untouched.

## Prepared source changes

- `scripts/prod-release-review.mjs` generates a complete hash-bound held inventory from the recorded evidence; it contacts no service and grants no deployment authority.
- `signup-access-draft.sql` separates the proposed signup trigger from profile creation and narrows anonymous access to the routing row. It is outside executable migrations, requires a reviewed helper, and does not activate the club list.
- The restored database runner and all publication holds remain unchanged. No applied migration was edited, excluded, repaired or replayed.

## Outstanding release blockers

1. Reconcile each of the 37 files with target object definitions and immutable recovered source. The supplied schema only covers profile/invitation/team columns, not all affected competition/media/chat functions and policies. Additional bounded target evidence is required before semantic reconciliation can be completed.
2. The old signup replacement, fixture test and DEV club activation cannot execute unchanged. Because they are already applied in DEV, do not modify them. Their exclusion requires a separately approved exact staging mechanism in the existing database runner, not invented ledger entries or a later corrective migration.
3. Review the extracted invitation helper for malformed configuration, scope conflicts and usage bounds; test the new BEFORE trigger alongside both existing AFTER triggers on an isolated representative database before adopting the draft.
4. Verify membership coverage, hosted sign-in/confirmation settings and the fresh routing configuration before separately approving activation of the verified production club IDs.
5. Integrate a reviewed complete ordered plan with the existing runner only after the above decisions. Preserve the hold until then; the evidence importer cannot unlock publication.
6. Hosted Netlify/Codemagic settings, credentials and exact-commit publication reads remain unavailable; signed Android/iOS delivery and tap-through need real devices and approved release-candidate builds.

No database, canister, function, scheduler, credential, hosting or store deployment occurred.