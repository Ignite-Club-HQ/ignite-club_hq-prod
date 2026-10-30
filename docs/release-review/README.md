# PROD compatibility preparation — 30 October 2026

## Evidence and limits

The owner supplied a SQL Editor CSV. `prod-evidence-2026-10-30.json` records its SHA-256 and the selected catalog results, without accounts, invitation tokens or scheduler commands. The connection identity was not independently established by these results; attribution to PROD is owner-supplied, not a direct hosted read by this workspace.

The export contains 1,137 unique applied versions, ending at `20261029094707`. All 37 current migration versions are absent. `pending-plan-2026-10-30.json` fingerprints every current file, marks each held, and retains the six existing protected migration hashes. Version absence does not establish schema absence or semantic equivalence. This is an offline review inventory, not a deployable or approved plan.

Production's supplied `handle_new_user` inserts only the profile ID. Existing account triggers are `on_auth_user_created` and `trg_auto_claim_eois`. No invitation guard functions or routing settings row are returned. Settings policies permit authenticated reads, not anonymous reads; anon already has SELECT granted. Broader existing grants are not evidence that anonymous RLS access is allowed. Do not alter unrelated grants without a separate review.

The separately supplied scheduler results show both reminder jobs active, referencing `internal_service_role_key` through an authorization header. They do not establish credential validity or delivery. Keep current schedules and credentials untouched.

## Prepared source changes

- **Follow-up evidence received:** the owner ran the combined 73-name query and uploaded the CSV. `prod-transition-evidence-2026-10-30.json` records its SHA-256 (`697d3bd4…02550f1d7`) and key facts: both legacy function contracts are the only ones present, all 19 requested tables have RLS enabled, the anonymous routing policy is still absent, all three buckets are private, both reminder schedules are active, and all ten genuinely-new objects are confirmed absent. See the addendum in `transition-recommendations-2026-10-30.md`.
- `transition-dispositions-2026-10-30.json` records all 37 original hashes and review-only dispositions, including nine proposed original exclusions. It is not an executable plan, and all entries remain held. 28 offline safeguards pass; no deployment-policy approval was added.

- `target-object-evidence.sql` returns the remaining catalog checks in one result table: affected public relations, columns, constraints, indexes, policies, grants, types, account/data triggers and their functions, plus storage policies. It reads no application records or scheduler commands. Run only in the owner-approved PROD SQL Editor; inspect definitions/defaults for embedded secrets before sharing. Conservative source-name extraction is not a complete SQL dependency parser; additional dependencies found during comparison require a follow-up scoped read.

- `scripts/prod-release-review.mjs` generates a complete hash-bound held inventory from the recorded evidence; it contacts no service and grants no deployment authority.
- `signup-access-draft.sql` separates the proposed signup trigger from profile creation and narrows anonymous access to the routing row. It is outside executable migrations, requires a reviewed helper, and does not activate the club list.
- The restored database runner and all publication holds remain unchanged. No applied migration was edited, excluded, repaired or replayed.

## Outstanding release blockers

**Latest review:** `transition-recommendations-2026-10-30.md` records all nine preserve/adapt recommendations and an ordered staging proposal. It corrects the earlier inventory: legacy event/invite contracts are still used, one overlap has unresolved effective ACLs, and three additional originals are DEV-only. All 37 files remain held; no ledger or deployment change is authorized. `transition-object-evidence.sql` covers missing equivalent helpers without application records or scheduler commands.

1. Catalog inventory for all 37 files is recorded from owner-supplied evidence (SHA-256 `e1de59c0…3b69`); complete behavioural reconciliation is not finished. Nine recommendations now favour preserving production behaviour and adapting only verified deltas. Further equivalent-helper evidence, effective ACL decisions, isolated acceptance and the exact approved staging mechanism remain required. The earlier 2/8/21/6 split is provisional and must not be used as a deployable manifest.
2. The old signup replacement, fixture test and DEV club activation cannot execute unchanged. Because they are already applied in DEV, do not modify them. Their exclusion requires a separately approved exact staging mechanism in the existing database runner, not invented ledger entries or a later corrective migration.
3. Review the extracted invitation helper for malformed configuration, scope conflicts and usage bounds; test the new BEFORE trigger alongside both existing AFTER triggers on an isolated representative database before adopting the draft.
4. Verify membership coverage, hosted sign-in/confirmation settings and the fresh routing configuration before separately approving activation of the verified production club IDs.
5. Integrate a reviewed complete ordered plan with the existing runner only after the above decisions. Preserve the hold until then; the evidence importer cannot unlock publication.
6. Hosted Netlify/Codemagic settings, credentials and exact-commit publication reads remain unavailable; signed Android/iOS delivery and tap-through need real devices and approved release-candidate builds.

No database, canister, function, scheduler, credential, hosting or store deployment occurred.