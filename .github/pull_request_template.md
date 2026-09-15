## Outcome

<!-- Describe the user-visible or operational outcome, not just the files changed. -->

## Scope

- [ ] This PR contains one reviewable behaviour or refactoring tranche.
- [ ] Unrelated local or cumulative branch changes are excluded.
- [ ] Production behaviour is unchanged, or the intended change is described below.

Intended behaviour change:

## Risk and boundaries

- [ ] Authentication, roles, RLS, or tenant isolation reviewed where relevant.
- [ ] Free/Pro entitlement impact reviewed where relevant.
- [ ] Messaging, notifications, Realtime, or cache-key scope reviewed where relevant.
- [ ] Payments/IAP impact reviewed where relevant.
- [ ] Android/iOS lifecycle, keyboard, deep-link, or native-plugin impact reviewed where relevant.
- [ ] Accessibility and loading/settling behaviour reviewed where relevant.

## Backend and infrastructure

- [ ] No database migration.
- [ ] Migration files are listed and destructive-migration guard implications reviewed.
- [ ] No Edge Function change.
- [ ] Changed Edge Functions and their authentication paths are listed.
- [ ] No secret, cron, Storage, Realtime, or external-dashboard change.
- [ ] Required operational configuration changes are documented without including secrets.

Migrations / Edge Functions / external configuration:

## Verification

Focused automated tests:

```text
Command(s) and result(s)
```

- [ ] TypeScript check passed.
- [ ] Production build passed.
- [ ] Relevant Vitest suites passed.
- [ ] Relevant Playwright journeys passed.
- [ ] Local Supabase integration passed where backend behaviour changed.
- [ ] Complete isolated baseline passed for the exact promotion commit.
- [ ] Required manual web/native checks completed.

Manual checks and intentionally untested areas:

## Promotion and rollback

- [ ] The source and destination branches follow `docs/PROMOTION.md`.
- [ ] This is not an unreviewed cumulative integration branch.
- [ ] Known-good rollback commit recorded.
- [ ] Database rollback uses a reviewed forward repair/restore plan where relevant.
- [ ] Release evidence and post-release smoke checks are identified.

Known-good commit and rollback approach:

## Evidence

<!-- Link CI runs and attach screenshots/video only where they materially aid review. -->
