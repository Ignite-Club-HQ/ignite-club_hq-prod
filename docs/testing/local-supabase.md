# Local Supabase security tests

This is an isolated, synthetic integration-test environment. It is not a
production schema snapshot and must never be used for deployment.

## Safety boundaries

- Use only the `local-supabase-workspace` project root.
- Never use the repository's `supabase` directory for these tests.
- Never provide an application `.env` file to the runner.
- Never supply a hosted URL, database password, access token, or hosted key.
- Never import real users, clubs, files, or Riverside data.
- Every Supabase CLI command requires explicit review and approval before use.

The test runner accepts only `http://127.0.0.1:54321` or
`http://localhost:54321`. It passes a narrow environment to Vitest and drops
application Supabase configuration.

Realtime, Storage, local email capture, and Edge Runtime are configured in the
isolated workspace because they support required later test layers. The initial
start command may still exclude them while validating the core schema. Each
service is included only by a separately reviewed start command and its tests
remain opt-in until that service is confirmed local.

Studio, analytics/log shipping, image transformation, connection pooling, and
database administration metadata remain disabled or excluded. They do not add
business-behaviour test coverage. Image transformation can be reviewed later if
the application begins relying on transformed-media authorization.

The Realtime suite is already designed in `tests/local-supabase/realtime-isolation.test.ts`.
It remains skipped unless the local stack was deliberately started with
Realtime and `LOCAL_SUPABASE_REALTIME_ENABLED=true` is supplied to the guarded
runner. It covers authorized delivery, cross-club denial, exact row filtering,
revocation and unsubscribe cleanup.

Storage integration tests will cover private bucket upload, authorized signed
access, cross-club denial, deletion, and post-revocation denial. Edge Runtime
contract tests will cover JWT enforcement, exact-scope entitlement checks,
fail-closed RPC errors, and safe response bodies. Mailpit tests will verify that
local authentication email flows are captured locally and never delivered to
real recipients. Those suites must use synthetic `.invalid` addresses only.

## Scope

The baseline intentionally contains only the schema required to test:

- role and membership isolation;
- exact-club Free/Pro entitlements;
- atomic guardian invitation acceptance;
- event and RSVP permissions; and
- minimal private-media authorization.

The schema was reconstructed from repository-controlled types and migrations.
It is not proof that the hosted schema is identical. Any later production
schema work must be independently reviewed.

## Workflow

1. Review `local-supabase-workspace/supabase/config.toml`, the baseline migration, and seed.
2. Run `npm run test:baseline` (or the **Tests: Complete safe baseline** task).
3. Review the exact local start and cleanup commands printed by the runner,
   then approve the complete local test session.
4. Verify every reported URL uses localhost.
5. The runner supplies only its fixed local API URL and local demo keys to the
   integration process; inherited Supabase and database variables are removed.
6. The runner executes frontend, Playwright, and local integration stages.
7. The runner stops the local stack after all stages, including when a test
   stage fails, and reports cleanup as a required result in its summary.

Start and cleanup use the pinned CLI version embedded in the runner. Both exact
commands are shown before execution and covered by one explicit local-session
approval; neither command contains hosted configuration or a remote target.

## Rollback

The environment is disposable. Stop its containers and discard its local
volumes. Removing `local-supabase-workspace`, the local integration tests, runner,
configuration, and package script fully removes this infrastructure without
affecting the application or historical migrations.
