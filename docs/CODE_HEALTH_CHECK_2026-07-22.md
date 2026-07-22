# Ignite Club HQ Code Health Check

**Assessment date:** 22 July 2026
**Overall maintainability score:** **5.8/10**

## Executive summary

Ignite Club HQ is supportable by an experienced React/Supabase vendor, but it would not be an easy or inexpensive handover today.

The application has a strong behavioural safety net—1,351 passing baseline tests—and substantial documentation. Its principal maintenance costs arise from oversized modules, weak TypeScript enforcement, a large and difficult migration history, inconsistent onboarding documentation, and quality checks that currently fail outside the baseline test workflow.

> Functional and well-tested, but structurally expensive to change.

This assessment was read-only. No database was contacted and no production code or configuration was changed.

## Scorecard

| Area | Score | Assessment |
|---|---:|---|
| Behavioural test protection | 8.5/10 | Excellent baseline across frontend, journeys, permissions, RLS, Realtime and Edge Functions |
| Architecture and modularity | 4/10 | Many extremely large pages and components combine UI, data access and business workflows |
| Type safety | 3.5/10 | TypeScript strictness is disabled and `any` is widespread |
| Database maintainability | 3.5/10 | Approximately 955 historical migrations and no independently verified clean historical rebuild |
| CI and release safeguards | 6/10 | Frontend tests run in CI; broader baseline, lint and type-checking do not |
| Documentation | 6/10 | Considerable documentation exists, but the principal README and some handover material are stale |
| Operational safety | 6.5/10 | Promotion checks and backups exist, but the release workflow is complex and knowledge-heavy |
| Vendor onboarding | 5/10 | An experienced vendor can take it over, but significant discovery work would be required |

## What is healthy

The strongest part of the codebase is its testing position:

- 1,351 recommended baseline tests pass.
- Critical permissions and membership behaviour are exercised against an isolated local Supabase stack.
- Realtime isolation and Edge Function behaviour have local coverage.
- Seven Playwright journeys protect important workflows.
- Tests avoid hosted development and production data.
- A consolidated baseline command starts and stops its own infrastructure.

Other positive characteristics include:

- Route-level code splitting in `src/App.tsx`.
- Deliberate React Query mobile and offline behaviour.
- Deployment guards, migration previews and backups in `.github/workflows/promote-to-prod.yml`.
- Generated Supabase database types.
- Substantial vendor handover documentation.

These characteristics mean the application is not an uncontrolled prototype. There is a solid foundation for improvement.

## Principal maintainability problems

### 1. Oversized modules

Excluding tests and generated Supabase types:

- 139 frontend files exceed 500 lines.
- 54 exceed 1,000 lines.
- Frontend production TypeScript/TSX is approximately 285,000 lines.
- Edge Functions add approximately 36,000–44,000 lines, depending on included support files.

Notable examples include:

- `VaultPage.tsx`: approximately 5,708 lines
- `AutoSubPlanDialog.tsx`: approximately 5,128 lines
- `EventDetailPage.tsx`: approximately 3,928 lines
- `AddTeamMemberSheet.tsx`: approximately 3,817 lines
- `PitchBoard.tsx`: approximately 3,402 lines
- `MessagesPage.tsx`: approximately 3,338 lines
- `HomePage.tsx`: approximately 3,305 lines
- `CompetitionFixturesPanel.tsx`: approximately 2,701 lines

These modules make changes slower to understand and harder to review. UI state, permissions, Supabase operations, realtime handling and business rules frequently coexist in the same file.

### 2. Limited TypeScript protection

`tsconfig.app.json` disables several useful safeguards:

- `strict: false`
- `noImplicitAny: false`
- `noUnusedLocals: false`
- `noUnusedParameters: false`
- `noFallthroughCasesInSwitch: false`

A rough scan found approximately 3,700 occurrences of `any` across frontend and Edge Function TypeScript. A no-output TypeScript check also currently fails in `useRemoteFillInSync.test.tsx`. This appears to be a test typing problem rather than proof of broken production behaviour, but type-checking is not currently a reliable quality gate.

### 3. Linting is not a functioning quality gate

At assessment time, `npm run lint` reported:

- 3,325 errors
- 237 warnings

Many are legacy `any` violations or archived code findings. However, lint also identified a genuine syntax problem in `supabase/functions/recover-account/index.ts`: `extractBearerToken` is missing its closing `}` before `checkRateLimit`. That function cannot parse or deploy successfully in its current form.

The passing baseline did not catch this because that particular Edge Function is not imported or started by the selected Edge Function suites. This should be fixed urgently, and systematic Edge Function parse/type validation should be added.

### 4. Difficult database history

The repository contains approximately 955 migration files. Previous investigation established that the complete historical migration chain could not cleanly reconstruct a new local database, which is why the isolated test environment uses a purpose-built local baseline.

The local environment is appropriate for tests, but does not prove that a vendor can recreate the complete application schema from repository history. Long-term ownership needs:

- A verified canonical schema baseline.
- A known point from which later migrations apply cleanly.
- A reproducible local rebuild process.
- A schema drift check that does not depend on tribal knowledge.
- Historical migrations retained until the baseline is independently verified.

This is probably the largest operational handover risk.

### 5. Distributed data access

Approximately 450 frontend files directly import the Supabase client. This makes consistent enforcement of permission assumptions, error handling, retry behaviour, cache invalidation, transaction boundaries, audit logging and data mapping harder.

The repository would benefit from small feature-level repositories or service modules rather than one large generic API layer.

### 6. Fragmented vendor onboarding

The root `README.md` is still the generic Lovable project README. It does not explain the domain architecture, safe local testing, branch and environment topology, migration policy, baseline workflow, deployment ownership or external systems.

The handover documents are useful, but some figures and descriptions are stale or inconsistent. References to internal memory, unresolved confirmation notes and stale migration counts should be removed from a vendor-facing package.

A tracked `.env` file also exists. Its contents were not inspected or exposed during this assessment. It should be reviewed to confirm it contains only safe public/local configuration and no hosted credentials.

## Recommended first refactoring target

Start with `CompetitionFixturesPanel.tsx`, one externally observable behaviour at a time.

Reasons:

- It is large enough to deliver meaningful maintainability gains.
- It belongs to a bounded business domain.
- Competition workflows have component and journey protection.
- Its fixture loading, result handling, form state, permission decisions and presentation can be separated.
- It is less globally coupled than authentication, messaging or `App.tsx`.

Suggested sequence:

1. Extract fixture/result data types and pure transformations.
2. Extract permission and action-availability rules.
3. Extract Supabase query and mutation operations.
4. Extract form state and validation.
5. Split smaller rendering components.
6. Keep the existing public component interface stable.

Run the complete baseline after every extraction. Add characterization tests only where an extraction exposes currently unprotected behaviour.

`VaultPage.tsx` is a possible second candidate, after targeted tests are added for critical media permissions and mutation failure paths.

## Prioritized recommendations

### Before vendor ownership

1. Fix and test the `recover-account` syntax defect.
2. Replace the generic README with a canonical onboarding guide.
3. Reconcile the handover documents against the current repository.
4. Document branch-to-environment mapping and deployment responsibility.
5. Inventory the tracked `.env` file without committing secrets.
6. Add a lightweight Edge Function parse/type validation command.
7. Put safe frontend tests and non-database quality checks into pull-request CI.

### Before significant refactoring

1. Select one bounded module rather than conducting an application-wide rewrite.
2. Record its externally observable behaviour and dependencies.
3. Confirm its relevant baseline tests.
4. Add only missing characterization tests.
5. Extract business logic and data operations before splitting visual markup.
6. Avoid changing database contracts and UI behaviour in the same pull request.
7. Use small, reviewable commits.

### Over the following months

1. Establish strict TypeScript islands for new or refactored modules.
2. Prevent new `any` usage without attempting a single mass cleanup.
3. Separate feature data access from large React components.
4. Consolidate repeated Edge Function authentication, CORS, validation and error handling into tested shared helpers.
5. Produce and independently verify a canonical local schema baseline.
6. Add lint/type budgets that prevent new debt while legacy debt remains.
7. Add architecture decision records for permissions, entitlements, realtime and multi-step mutations.
8. Document dependencies and ownership for Stripe, Firebase, Supabase, email and mobile builds.

## Expected vendor onboarding

An experienced React, TypeScript and Supabase vendor should be able to handle routine defects fairly quickly because the test suite provides useful feedback. A reasonable expectation is:

- Several days to understand the repository and deployment model.
- Two to four weeks to become comfortable with core feature work.
- Longer to safely own migrations, RLS, Realtime and production promotion without assistance.

The application is handover-capable, but not yet handover-efficient. This is likely to result in higher estimates, longer investigation time and reliance on senior engineers.

## Refactoring readiness

The current baseline is sufficient for carefully staged refactoring of a bounded, well-covered feature. It is not sufficient justification for a broad architectural rewrite.

Before modifying a selected module, map its behaviours to existing tests and add only missing characterization cases. The current suite is strong enough that code structure, type boundaries and handover documentation should now take priority over indiscriminately increasing test volume.
