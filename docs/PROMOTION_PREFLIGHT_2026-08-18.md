# Cumulative refactor promotion preflight — 18 August 2026

**Source branch:** `integrate/competition-current`
**Verified application tree:** `bca406b0c`
**Evidence/documentation commit:** `69bc18189`
**Target base inspected:** `origin/main`
**Status:** Prepared; no tranche has been merged or promoted.

## Why construction is gated

The source is 353 commits ahead of `origin/main`. The comparison spans 744
files after the evidence update. A preliminary path classifier produced 497
“governance” files because test files for every domain are interleaved with
their owning production changes. That classification is intentionally rejected:
tests must travel with the production behaviour they protect, and shared files
must be assigned through dependency review rather than filename guesses.

The cumulative branch must not be merged directly into `main` or `prod`.

## Safe construction algorithm

For each tranche in `PROMOTION_TRANCHES_2026-08-17.md`:

1. Authenticate GitHub and fetch the current `origin/main`.
2. Create a fresh `promotion/<number>-<domain>` branch from that immutable SHA.
3. Build a manifest of production files, their focused tests, required shared
   contracts, migrations and Edge Functions.
4. Apply changes by reviewed behavioural ownership. Do not cherry-pick merge
   commits or copy a path glob without inspecting dependencies.
5. Run production TypeScript, the tranche suite, build and destructive migration
   guard. Run the complete isolated baseline on the cumulative candidate.
6. Open a draft PR to `main`; do not enable auto-merge.
7. Record base SHA, candidate SHA, evidence, reviewer and rollback SHA in the
   tranche table.
8. Merge only after required human/device/provider checks for that tranche.
9. Start the next tranche from the new `main`, never from the previous promotion
   working branch.

## Stop conditions

- A test requires application behaviour assigned to a later tranche.
- A migration or Edge Function cannot be assigned to one owning domain.
- A backend change would deploy before its compatibility window is understood.
- The tranche changes unrelated user-visible behaviour.
- Focused or complete verification fails or becomes flaky.
- The exact candidate cannot be deployed to an isolated preview.
- A rollback cannot be expressed as a frontend revert or reviewed forward
  backend repair.

## Current blockers

- GitHub authentication was expired at this checkpoint, so no remote promotion
  branches or draft PRs were created.
- Physical Android/iOS and live provider acceptance remains outstanding.
- The application tree is fully automated-test green; these blockers concern
  release evidence and safe promotion, not a known application failure.
