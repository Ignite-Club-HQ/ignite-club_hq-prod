# PROD compatibility transition recommendations

## Decision and limits

Preserve working production behaviour and adapt only verified differences. **Do not merge or deploy this release yet.** This is an offline source-backed proposal, not approval to change a database, migration ledger, permission, scheduler, hosting setting or canister. All 37 source files remain fingerprinted and held. Applied DEV files and the recovered historical archive are unchanged.

Evidence is the owner-attributed catalog export with SHA-256 `e1de59c00013c1a30bf62b3e085a75df012c6d4ed7e51b53c41939f87cc93b69`. Connection provenance is not independently verified. The existing report's similarity scores and requested-name absences are inventory clues, not semantic equivalence or proof that a feature is missing.

## Corrections to the earlier report

- Current callers still use the **legacy event RPC**. `frontend/src/pages/CreateEventPage.tsx:1152` calls it directly. `createSupabaseCompetitionEvent.ts` tries the new contract and falls back only after the matching non-executed `PGRST202` signature miss. Do not remove the old overload.
- `TeamDetailPage.tsx:1046` sends `_user_id` and `_team_id`; the pending one-argument invite helper is an additional overload, not an automatic replacement.
- `20261007010000` matches the complete ladder-column statement: boolean, NOT NULL, DEFAULT false. It remains a staging candidate, not staging approval.
- `20261015192331` matches schema, constraints, indexes, five policies, two triggers and four function contracts/implementations; **effective ACLs need a separate decision**. The export shows broader table privileges including TRUNCATE for anon/authenticated and explicit anon acceptance-function execution. RLS does not gate TRUNCATE. Do not infer that replaying its additive grants would remove broader grants.
- The three `20261030030705`, `20261030030741`, `20261030031128` self-removal files raise `DEV database only`; they cannot run on PROD as authored. Alongside the earlier six exclusions, **at least nine current originals cannot be submitted unchanged**.
- Category C is provisional: it contains existing-object edits, missing explicit grants, existing-club backfill, scheduler activation and destructive retention capabilities. “21 safe new changes” is not a release conclusion.

## Nine behaviour decisions

| Area | Recommended disposition | Required acceptance |
|---|---|---|
| Duty-team validation | Keep one existing trigger and preserve unchanged historical assignments. Add new-assignment lifecycle restrictions only in the reviewed adaptation, not by replaying a second trigger. | Null allowed; cross-club/deleted teams denied; no double trigger; archived historical assignment survives unrelated fixture maintenance. Shell/lifecycle changes require explicit acceptance. |
| Competition event creation | Keep the seven-argument RPC. Hold per-team fanout. If needed, add the eight-argument idempotent contract as an adapter retaining production's one canonical competition event and audience. | Creator excluded, deduplicated audience, past-event behaviour, suppression ownership, competition linkage and queued-count return semantics; retries after lost replies do not duplicate writes. |
| Competition photo access | Retain uploader/manager grants. Reconcile the actual participant helper before adding restrictive boundaries; pending role/status membership differs. | Accepted/registered/withdrawn entries, parents without team role rows, officials, app admins; metadata and stored bytes; UPDATE scope changes and DELETE boundary. |
| News reads/discovery | Preserve officials' access. Adapt caller-scoped discovery and retain one authoritative exclusive-audience validator. | Entered-team discovery, officials can read notified posts, no draft/future leakage, cross-club and mixed scopes denied. |
| News notifications | Preserve existing unified notifier behaviour; add reviewed split-RPC adapters or one shared implementation, not another independent fanout. | Direct RPC authorization, publication gating, author exclusion, deduplication across both APIs; push-off still creates intended in-app notifications; counts are queued, not delivered. |
| Competition Vault | Preserve roots, code-of-conduct/photo mirrors and legacy paths. Treat participant reads as a deliberate expansion; reconcile old restrictive policies and new permissive grants together. | Chat-linked folders still require chat access except approved admin bypass; restricted roles and parent/file scopes cannot be bypassed; metadata and signed-object access agree. |
| Team invitations | Retain the two-argument contract initially. Bind authenticated caller identity; do not retire it while current clients use it. Adopt lifecycle/status/delete changes separately. | Spoofed `_user_id` denied; own-team captain and authorized competition admin succeed; cross-club, unrelated users and non-player/parent grants denied. |
| Official links/invites | Preserve existing tables, tokens, uniqueness, triggers and equivalent policies. Reconcile exact ACLs and UPDATE checks; never add duplicates based on names. | Anonymous status lookup retained, anonymous acceptance cannot mutate, revoke/move constraints enforced, repeat acceptance and profile claims idempotent. |
| Score privacy / History | Adopt the privacy objective through a combined target-specific adaptation of `20261021003048` and `20261021003143`, not verbatim replay. Preserve existing hide values and richer fixture sync. | Verified backfill before plaintext clearing; zero/null/orientation/conflicts handled; History survives reschedule/team swap/unschedule/deletion; raw REST, DTOs, stats and reports all mask hidden scores. |

### Important implementation boundaries

**Events:** pending fanout creates team events and returns an event count; production creates one competition-linked event and returns inserted notifications. Existing UI describes people invited. These are different contracts. Authorization must match the picker’s `can_create_competition_event`; inspect `competition_event_audience` and event notification triggers before drafting the adapter. Use canonical typed timestamps in fingerprints and preserve the same operation key on ambiguous retry. Never retry a timed-out write via the legacy API.

**Vault:** in the pending policy, qualify outer-row comparisons explicitly (`parent.club_id = vault_folders.club_id`, `parent.competition_id = vault_folders.competition_id`, and corresponding `folder`/`vault_files` comparisons). Unqualified inner-scope columns can become self-comparisons. Adding a stricter permissive policy does not restrict existing permissive grants; adding a restrictive policy can intersect existing restrictions and accidentally deny everybody. Review complete policy composition, not individual predicates.

**Scores:** part 1 tries to add hide columns already present and changes existing scores/data. Match/event/History source disagreements need deterministic resolution, coverage checks and approved preservation before any nulling. Retain event-ID reuse and suppress duplicate notifications on reassignment; the pending team-bound lookup can leave an old-team event active. Preserve external-fixture override rules and tenant-scoped PlayHQ IDs. Part 2's function-name privilege sweep must become exact reviewed signatures. Neither production data clearing nor lock-heavy FK work is authorized by this proposal.

## Additional effects to separate from ordinary schema work

1. `20261008014417` writes `home_country = 'AU'` onto existing clubs. Do not infer actual countries from a catalog. Stage a schema-only adaptation; a data-owner-approved mapping/backfill is a separate action.
2. `20261012010000` enables pg_cron, unschedules an existing named job and schedules a new reminder processor. Keep its activation outside the ordinary schema step until separate scheduler approval and a secret-free named-job inventory. Existing reminder jobs/credentials remain untouched.
3. `20261014062816` installs service-executable photo/Vault deletion routines. Installation is not deletion, but preserve current cleanup logic and review storage/metadata eligibility differences before separately approved activation. No purge, pruning or scheduler edits here.
4. Explicit grants are missing/incomplete for new tables in `20261009100000`, `20261010000000`, `20261012020000`, `20261013000000`. Reviewed replacement SQL must include grants immediately after every new public table, before RLS/policies, tuned to actual callers and service_role. Welcome settings also omit authenticated DELETE despite a DELETE policy. Do not edit applied originals or rely on broad default grants.
5. Self-removal requires a separate PROD adaptation preserving exact-row authorization, owner protection and existing chat-sync triggers. The DEV guard cannot simply be stripped. Outstanding ICP self-leave work remains separately tracked.
6. Signup authorization stays a separate reviewed BEFORE INSERT trigger with the production ID-only profile function and both AFTER triggers intact. Reject a NULL/unknown invitation decision (`IS NOT TRUE`), not just explicit false, in the future reviewed draft. Activation of the two verified production IDs remains separate and must preserve other routing settings.

Welcome/ICP staged services, their secrets and measured-media SQL remain **post-merge activation work under the owner's earlier ruling**, not new merge blockers. This does not make unrelated unsafe migration history executable.

## Ordered staging proposal — no ledger changes yet

1. Freeze the exact source commit, ordered 37-file inventory and both evidence fingerprints. Keep `auth-release-policy.json`, the current database runner hold and publication checks unchanged.
2. Obtain missing equivalent-helper definitions with `transition-object-evidence.sql`. It is a bounded catalog-only query; review definitions for embedded secrets before sharing. Bucket/privacy and existing reminder schedule evidence remain separate scoped checks, not inferred from public policy names.
3. Draft a complete disposition for **every original**: verified no-replay overlap, original eligible only after full-effects review, target-specific replacement, DEV exclusion, or separately deferred activation. Bind replacements to their own hashes and original hashes. Never silently filter files or mark DEV-only work as actually executed.
4. Agree the staging mechanism before implementing it in the existing `promote-to-prod.yml` path. Prefer an exact clean migration workspace retaining verified historical sources and adding reviewed target adaptations; do not sweep/revert the 1,137 target ledger versions. Any metadata reconciliation needs an independently verified target, approved exact manifest and fail-on-error readback. No heuristic baselines, orphan repairs, `DROP CASCADE`, or swallowed failures.
5. Rehearse on an isolated representative database with production-equivalent schema, triggers and grants plus synthetic private-data edge cases. Verify every original is accounted for, excluded SQL cannot enter the workspace, all dependencies/grants precede use, and drift/reorder/hash mismatch blocks execution.
6. Integrate read-only preflight, approved exact inventory and reviewed database/function deployment into the existing runner only after acceptance. Do not restore the archive's changed-file-only scan: DO bodies execute at migration time and cannot be stripped as supposedly inert. Do not restore automatic cron/Vault credential rewrites.
7. Independently verify hosted settings, exact-commit database/ICP completion and signed Android/iOS notification acceptance before separate release approval. Do not merge first and hope later corrective SQL fixes earlier unsafe execution.

## Validation performed now

23 existing offline release/recovery safeguard tests passed. Source inspection confirms retained legacy event and invite callers. No target transition or authenticated/native flow was exercised; the acceptance matrix above is required work, not passed evidence. No production state or release activation changed.