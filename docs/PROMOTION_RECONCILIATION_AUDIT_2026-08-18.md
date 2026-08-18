# Promotion reconciliation audit — 2026-08-18

## Compared revisions

- Base: `origin/main` at `0fdd85016736c461dbd8cfa706c8b4b1e96a806d`
- Recorded source: `integrate/competition-current` at `53d0cbeac90085da2222a5ada6fa1f487d96248b`
- Source content parent: `a23f74c45a47f65301b19a0a241ec5ada110d17a`
- Final cumulative promotion candidate: `e3846c4aa0b7f60bed16db58e5cb5eef7d61828d`

This is a repository-only audit. It did not contact a hosted Supabase project,
deploy an Edge Function, apply a production migration, merge a branch, or alter
application behavior.

## Result

The Tranche 00–08 candidate is not yet a complete representation of the
recorded source. There are 71 residual paths:

- 59 source changes that were not represented in the cumulative candidate and
  require reviewed reconciliation;
- 11 content differences where the candidate should be retained because the
  source difference is whitespace-only or the candidate contains a later test
  stabilization/cleanup fix;
- 1 candidate-only local-fixture tracking document that should be retained.

No residual path is explained by a newer `origin/main`; the base SHA is the
same SHA used to construct the promotion sequence.

## Release-blocking omissions

These are not documentation-only differences and must be reconciled before the
promotion PR sequence is described as source-complete.

### Production and dependency boundary

- `package.json`
- `package-lock.json`
- `deno.lock`
- `src/hooks/useRealtimePerfSampler.ts`
- `supabase/functions/check-pending-subs/index.ts`
- `supabase/functions/check-pending-subs/recipient-policy.ts`

The telemetry hook bounds its pending queue and scopes `message_reads` to the
current user. The Edge Function change extracts its existing recipient policy
so the exact production policy can be tested. The package and lockfile delta
contains the strict gates and reviewed dependency/security candidate set; it
must be reviewed as a production dependency change, not treated as test-only.

### Baseline ownership and configuration

- `.github/workflows/codespaces-review-baseline.yml`
- `README.md`
- `scripts/run-baseline.sh`
- `scripts/run-complete-baseline.mjs`
- `tsconfig.strict-features.json`
- `tsconfig.strict-workflows.json`
- `local-supabase-workspace/supabase/config.toml`

The local Supabase config difference is semantic: it makes the local
`pitch-timer-event` fixture perform its own authentication consistently across
CLI image versions. It remains local-only.

### Missing browser journeys

- `e2e-baseline/auth-safety.spec.ts`
- `e2e-baseline/committee-invite-mobile-signup.spec.ts`
- `e2e-baseline/recurring-series-end-date.spec.ts`

### Missing component, hook, library and page coverage

- `src/components/LegalReacceptanceGate.test.tsx`
- `src/components/PasskeyManagementDialog.test.tsx`
- `src/components/admin/LegalReacceptanceAdminCard.test.tsx`
- `src/components/layout/AppLayout.routing.test.tsx`
- `src/hooks/useBlockedUsers.test.tsx`
- `src/hooks/useCanStartGame.test.tsx`
- `src/hooks/useLazyFabric.test.tsx`
- `src/hooks/useLegalReacceptance.test.tsx`
- `src/hooks/usePublishChatImage.test.tsx`
- `src/hooks/useRealtimePerfSampler.test.tsx`
- `src/hooks/useRemoteFillInSync.test.tsx`
- `src/hooks/useTypingIndicator.test.tsx`
- `src/lib/failedSendRestore.test.ts`
- `src/lib/imageCompression.test.ts`
- `src/lib/matchResultFormat.test.ts`
- `src/lib/proShareGate.test.ts`
- `src/lib/uploadErrorUtils.test.ts`
- `src/pages/ManageUsersPage.characterization.test.tsx`

### Missing Edge Function and repository guards

- `src/edge-functions/checkPendingSubs.recipients.test.ts`
- `src/edge-functions/edgeFunctionEstateValidation.test.ts`
- `src/edge-functions/recoverAccount.test.ts`
- `src/edge-functions/sendEngagementReminders.accuracy.test.ts`
- `src/edge-functions/verifyIapReceipt.security.test.ts`
- `src/test/androidResumeZombieRequests.guard.test.ts`
- `src/test/braceExpansionSecurityUpgradeSafety.test.ts`
- `src/test/deletedTeamPickerIsolation.guard.test.ts`
- `src/test/destructiveMigrationGuard.test.ts`
- `src/test/fabricUpgradeSafety.test.ts`
- `src/test/highSeverityDependencyUpgradeSafety.test.ts`
- `src/test/legalReacceptanceSecurity.guard.test.ts`
- `src/test/postcssSecurityUpgradeSafety.test.ts`
- `src/test/reactRouterUpgradeSafety.test.tsx`
- `src/test/remainingDependencySecuritySafety.test.ts`
- `src/test/roleSurfaceUiContract.characterization.test.ts`
- `src/test/transitiveSecurityUpgradeSafety.test.ts`
- `src/test/vendorRepositoryGovernance.guard.test.ts`
- `src/test/viteUpgradeSafety.test.ts`
- `src/test/xmldomSecurityUpgradeSafety.test.ts`

### Missing integration and local-baseline coverage

- `tests/integration/events.rls.test.ts`
- `tests/local-supabase/database-invariants.test.ts`
- `tests/local-supabase/edge-runtime-auth.test.ts`
- `tests/local-supabase/localBaselineRunner.unit.test.ts`
- `tests/local-supabase/role-surface-access-matrix.test.ts`

## Candidate versions to retain

The following residual differences are not omissions:

- `docs/PROMOTION_DEFERRED_LOCAL_FIXTURES.md` exists only in the candidate and
  is the durable record of the local-only fixtures collected in Tranches 06–08.
- `docs/REFACTORING_READINESS_REMAINING_TEST_PLAN.md` and
  `docs/REFACTORING_VAULT_PLAN_2026-08-07.md` differ only because trailing
  whitespace was removed in Tranche 08.
- `src/components/pitch/PitchBoardResumeRedirect.test.tsx` contains the later
  `waitFor` stabilization proven by the 4,805-test cumulative run.
- `src/test/setup.ts` contains the later animation-frame cleanup added by the
  cumulative promotion and should not be reverted to the source version.
- `local-supabase-workspace/supabase/functions/pitch-timer-event/index.ts`,
  `local-supabase-workspace/supabase/migrations/20260801040000_local_pitch_timer_concurrency.sql`,
  `src/pages/HomePage.nextUp.characterization.test.ts`,
  `tests/local-supabase/entitlements.rls.test.ts`,
  `tests/local-supabase/pitch-timer-concurrency.test.ts`,
  `tests/local-supabase/roles-membership.rls.test.ts`, and
  `vitest.local-supabase.config.ts` differ only by a final blank line.

## Recommended reconciliation sequence

Do not rewrite or force-push the already verified Tranche 00–08 branches.
Create new cumulative branches from `e3846c4aa`:

1. **09A — baseline and dependency reconciliation.** Restore the dependency
   manifests, complete baseline runner/workflow, strict TypeScript configs,
   local configuration, README, browser journeys, characterization tests,
   security guards and local integration tests. Review dependency changes
   explicitly and run every upgrade-specific gate plus the complete isolated
   baseline.
2. **09B — telemetry and recipient-policy reconciliation.** From accepted 09A,
   restore `useRealtimePerfSampler.ts`, the `check-pending-subs` extraction and
   their direct tests. Run focused telemetry/recipient tests, Deno or equivalent
   Edge validation, TypeScript/build, the frontend suite and the complete local
   Supabase baseline.

The `check-pending-subs` directory is deployable production code. A 09B review
does not authorize deployment; deployment and rollback handling remain subject
to the release workflow and the existing Edge Function compatibility record.

## Acceptance condition

After 09B, repeat this exact comparison. The only permitted residuals are the
12 candidate-retained paths listed above. Record the new candidate SHA, test
evidence and rollback point before opening the sequential promotion PRs.
