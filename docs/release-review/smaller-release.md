# Smaller release: sign-in and existing administrator settings

## Scope

Prepare sign-in tabs, retained email access and existing Placement Settings controls separately from score work. The selected form opens immediately; public labels contain no club names. Existing administrators keep their current permissions. This does not activate every new administrator capability already present on main.

**No production merge, deployment or activation has occurred.** A whole-main merge is not a smaller release: main contains changed score readers/writers, additional routes, backend changes and unreconciled migrations. Selective source/dependency review against the exact deployed production commit is required before a release branch can be assembled. Repository metadata and DEV-applied migrations stay untouched.

## Prepared package

`smaller-release-review.json` accounts for **all 38 current migration files**, not just the previous 37-file inventory. Every original is fingerprinted and excluded from execution in this scope. The newly added DEV AI access-state migration is explicitly deferred rather than silently omitted from the audit.

Eight frontend source entry points are fingerprinted as a proposed selective scope, not as a complete bundle or dependency closure. Two existing SQL drafts are candidates for **isolated rehearsal only**:

1. Private invitation eligibility helper.
2. Separate BEFORE-signup authorization trigger and routing-row-only anonymous policy.

These preserve production's ID-only profile creation and existing account AFTER triggers. They do not update routing configuration or activate the retained-club list. Activation must preserve every existing routing property, verify both production club identities/membership and follow a fresh approved target read. No DEV IDs may be copied into production.

Regenerate the offline review with `node scripts/smaller-release-review.mjs`. It never contacts a database, applies SQL, repairs a ledger or enables a release runner. A new or changed migration fails the inventory check until separately reviewed.

## Explicitly deferred, not blockers for this scope

- Score/History reconciliation, storage, backfills, clearing and new privacy transitions. Keep current production score reads/writes unchanged.
- AI score review, its access-state table and service activation. DEV activation remains independently blocked on deployment authorization.
- New competition-role self-removal and unverified administrator capabilities.
- The other nine-feature review adapters. None is silently adopted by this package.

Existing scores, History, media, Vault, push schedules, credentials and notification audiences remain unchanged. Publishing altered frontend score code while excluding its database changes would **not** satisfy this scope.

## Remaining release work

1. Review and assemble selective source/dependency changes against the exact production commit; preserve production score paths and omit AI review navigation/routes from that release, without deleting DEV work.
2. Approve the exact original/replacement staging mechanism through the existing database promotion path. Do not run `supabase db push` against all main migrations or invent applied ledger entries. The current runner stays deliberately held.
3. Reconcile the candidate SQL with independently verified current target definitions and perform representative profile/invitation lifecycle acceptance. Synthetic tests are useful but do not prove hosted Auth settings.
4. Verify hosted email signup/confirmation, secure sign-in origins/canister configuration, administrator settings permissions and retained member/invited-new-member flows. Authenticated hosted checks are unavailable here for this externally managed Supabase.
5. Verify Netlify/Codemagic production context and exact-commit publication ordering. Check sign-in and existing push receipt/tap-through on release-candidate phones; do not alter scheduler activation to accomplish this.

**Score work is not a remaining prerequisite for this smaller release.** The blockers above concern source isolation, safe sign-in adoption and hosted acceptance only. Preparation is not release authorization.