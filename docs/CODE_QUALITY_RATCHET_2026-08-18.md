# Code quality ratchet — 18 August 2026

**Status:** Current measured debt and change policy. This is not evidence of a
production defect and must not be used to justify an unreviewed bulk rewrite.

## Measured baseline

ESLint over `src/**/*.{ts,tsx}` reported:

- 3,552 errors and 242 warnings across 572 files.
- 3,377 `@typescript-eslint/no-explicit-any` findings.
- 158 `react-hooks/exhaustive-deps` warnings across 71 files.
- 25 messages without a rule ID across 17 files. Inspection confirmed these
  are unused `eslint-disable` directives, not TypeScript parser failures.

The production TypeScript compiler gate and strict feature/workflow gates pass.
The complete isolated baseline at commit `bca406b0c` also passes. The figures
above therefore describe maintainability debt, not a failed release gate.

## Hook-risk classification

| Area | Findings | Review priority |
| --- | ---: | --- |
| Messaging, inbox and chat | 53 | High: subscription, reveal, reconciliation and stale-closure risks |
| PitchBoard and AutoSub | 34 | High: timer, substitution and resume behaviour can regress |
| Events | 16 | Medium-high: form derivation and attendance state |
| Vault | 13 | Medium-high: scope, search and mutation callbacks |
| Media | 9 | Medium: realtime and observer cleanup |
| Auth, theme and lifecycle | 6 | High despite lower count: startup and identity boundaries |
| Other UI/features | 27 | Review when the owning feature changes |

The largest concentrations are `MessagesPage.tsx` (15), `PitchBoard.tsx` (14),
`VaultPage.tsx` (11), `useAutoSubs.ts` (8), and `EventDetailPage.tsx` (7).

## Required policy

1. Do not auto-add every suggested dependency. A mechanically “clean” hook can
   create repeated effects, duplicate writes, subscription churn or timer resets.
2. A changed production file must not increase its ESLint error or warning count.
3. New feature-boundary files should contain no explicit `any` unless a local,
   documented external-library boundary makes it unavoidable.
4. Review hook findings in the same behavioural tranche as their owning feature,
   with focused tests before and after the change.
5. Remove unused disable directives opportunistically; they are safe cleanup but
   not important enough to justify a broad standalone production diff.
6. Parser errors, if introduced in future, are release-blocking. The 25 current
   no-rule messages are not parser errors.

## Recommended sequence

1. Auth/lifecycle warnings.
2. Messaging subscription and reconciliation warnings.
3. Pitch timer and AutoSub warnings.
4. Event mutation/derived-state warnings.
5. Vault and Media observer/query warnings.
6. Low-risk memoisation and constant-dependency warnings.

Each group requires its existing focused suite plus the full baseline before
promotion. Stop if a dependency change alters effect frequency or user-visible
behaviour unexpectedly.
