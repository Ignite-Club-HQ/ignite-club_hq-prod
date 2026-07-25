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
isolated workspace because they support the required integration layers.

Studio, analytics/log shipping, image transformation, connection pooling, and
database administration metadata remain disabled or excluded. They do not add
business-behaviour test coverage. Image transformation can be reviewed later if
the application begins relying on transformed-media authorization.

The Realtime suite in `tests/local-supabase/realtime-isolation.test.ts` runs in
the complete baseline with `LOCAL_SUPABASE_REALTIME_ENABLED=true`. It covers
authorized delivery, cross-club denial, exact row filtering, revocation and
unsubscribe cleanup.

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
- minimal private-media authorization;
- competition creation, invitation and response; and
- notification preferences, isolation and read state.

The schema was reconstructed from repository-controlled types and migrations.
It is not proof that the hosted schema is identical. Any later production
schema work must be independently reviewed.

## Workflow

1. Review `local-supabase-workspace/supabase/config.toml`, the baseline migration, and seed.
2. Run `npm run test:baseline` (or the **Tests: Complete safe baseline** task).
3. Review the exact local start and cleanup commands printed by the runner,
   then approve the complete local test session.
4. Verify every reported URL uses localhost.
5. The runner removes only its explicitly allowlisted local containers and
   volumes so every run starts with empty synthetic state.
6. It discovers the generated publishable and secret keys from the isolated
   local gateway; inherited Supabase and database variables are removed.
7. It compares every migration filename with the local migration ledger and
   refuses integration tests unless they match exactly.
8. Before Docker starts, a file-only parity guard scans newly merged production
   migrations for changes to mirrored competition and membership contracts. It
   stops with the exact migration names when a deliberate local review is needed.
9. The runner executes frontend, Playwright, and local integration stages.
10. In a final cleanup (including failures and interruption), it removes and
   verifies absence of all allowlisted local containers and volumes. Cleanup is
   a required result in the summary.

For an approval already given immediately before execution, use the single-command form:

```bash
npm run test:baseline -- --approved-local-session
```

That one approval covers the safe branch fast-forward and the displayed local
Supabase startup/cleanup lifecycle. Without the exact flag, the runner retains
its interactive approval prompt. On a clean worktree, the runner performs the
safe branch fast-forward check. If local changes are present, it skips all
fetch/merge activity and tests the current files in place without staging,
committing, stashing, restoring or deleting them. Wrong branches, diverged clean
branches, stale contract parity, or unexpected Docker targets still stop rather
than proceeding.

Startup uses the pinned CLI version embedded in the runner. Cleanup uses an
explicit immutable allowlist of Docker resources whose names end in
`ignite-club-local-security-tests`. The action and targets are shown before
execution and covered by one explicit local-session approval; no lifecycle
command contains hosted configuration or a remote target.

## Rollback

The environment is disposable. Stop its containers and discard its local
volumes. Removing `local-supabase-workspace`, the local integration tests, runner,
configuration, and package script fully removes this infrastructure without
affecting the application or historical migrations.
