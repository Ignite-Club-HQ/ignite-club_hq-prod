# Ignite Club HQ

Ignite Club HQ is a multi-club sports-management platform covering membership,
events and RSVP, messaging, media and vault content, competitions, notifications,
subscriptions, and game-day pitch-board workflows. It ships as a React web app
and as Capacitor-based Android and iOS apps, backed by Supabase.

This README is the canonical starting point for engineers and support vendors.
Start with the documents below before changing or deploying the system.

## Start here

1. [Architecture](docs/ARCHITECTURE.md) — system boundaries, data flows, security
   invariants, and known structural debt.
2. [Promotion and rollback](docs/PROMOTION.md) — branch roles, validation gates,
   production impact, and rollback rules.
3. [Vendor technical handover](docs/VENDOR_HANDOVER.md) — detailed feature and
   operational reference.
4. [Documentation index](docs/README.md) — authoritative, supporting, and
   historical documents.

## Technology

- React 18, TypeScript, Vite 7, React Router, and TanStack Query
- Capacitor 8 for Android and iOS
- Supabase Auth, Postgres/RLS, Realtime, Storage, and Edge Functions
- Vitest/Testing Library, Playwright, and an isolated local Supabase baseline

The lockfile is authoritative for resolved dependency versions.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/pages` | Route-level screens and composition |
| `src/features` | Extracted feature contracts, queries, mutations, and orchestration |
| `src/components` | Shared and feature UI |
| `src/hooks` | Cross-feature application hooks and legacy feature logic |
| `src/integrations/supabase` | Browser Supabase client and generated database types |
| `supabase/migrations` | Hosted database migration history |
| `supabase/functions` | Deployable Supabase Edge Functions |
| `local-supabase-workspace` | Disposable, synthetic, local-only integration environment |
| `tests` / `e2e-baseline` | Integration and Playwright baseline journeys |
| `scripts` | Test, safety, release, and operational automation |
| `.github/workflows` | CI and production promotion automation |

## Local frontend development

Prerequisites: Node.js 22.12 or newer and npm.

```bash
npm ci
npm run dev
```

Application environment values are deployment-specific. Never copy production
credentials into a local shell, test command, fixture, or committed file. Obtain
the correct non-production setup through the repository owner.

## Quality gates

Fast checks:

```bash
npm run typecheck:production
npm run typecheck:strict-features
npm run build
npm run test:run
```

The complete baseline runs frontend tests, Playwright journeys, and a disposable
Docker-based Supabase stack:

```bash
npm run test:baseline
```

Read [the local Supabase safety guide](docs/testing/local-supabase.md) before the
first run. The baseline accepts only localhost Supabase endpoints and synthetic
data. Hosted Supabase testing is deliberately disabled.

CI automatically runs the complete isolated baseline only on
`codespaces-review`. Frontend tests also run on `main` and pull requests to
`main`. A green build is necessary but does not replace the manual native and
role-based checks required for a release.

## Branch and deployment warning

- `main` is the primary development line.
- `codespaces-review` is the isolated full-baseline validation line.
- `prod` is a deployment trigger, not a general working branch.

Pull requests targeting `prod` run repository-only migration and Edge Function
validation. Production credentials and commands are isolated in a separate job
that cannot run for pull-request events and requires the `prod` ref. Merging or
manually dispatching from `prod` remains a production operation. Follow
[the promotion runbook](docs/PROMOTION.md) exactly.

Never deploy a cumulative refactor/integration branch directly. Promote one
reviewed tranche at a time from a branch based on the latest `main`, preserve a
known-good commit reference, and verify the exact commit being released.

## Documentation rules

- Update architecture and promotion docs in the same change when their contract
  changes.
- Generated types and lockfiles are authoritative over prose version claims.
- Dated audits and refactoring plans are evidence of a point in time, not current
  operating instructions.
- Never put secrets, user data, hosted database URLs, or project credentials in
  documentation or fixtures.
