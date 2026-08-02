# Ignite Club HQ — Comprehensive Codebase and Vendor-Readiness Audit

**Assessment date:** 26 July 2026
**Scope:** Repository architecture, frontend, Supabase schema/migrations, Edge Functions, security controls, testing, CI/CD, dependencies, performance, observability, disaster recovery, and vendor handover readiness.
**Overall maintainability score:** **6.1/10**
**Vendor takeover readiness:** **5.7/10**

## Executive assessment

Ignite Club HQ is a substantial, functioning product with an unusually strong behavioural test baseline. It is safer to change than its structure initially suggests: the current one-command baseline passed 1,604 active frontend tests, 12 Playwright journeys, and 123 isolated local Supabase tests, with automatic infrastructure cleanup. Critical roles, memberships, entitlements, events, notifications, Realtime, storage, and selected Edge Function behaviours have meaningful protection.

The application is nevertheless expensive to understand and operate. Its main constraints are very large mixed-responsibility modules, pervasive direct data access, disabled TypeScript strictness, non-functioning lint and type-check gates, 963 tracked database migrations, inconsistent Edge Function dependencies and security configuration, stale onboarding material, and substantial single-owner/bot-generated history.

One critical revenue-integrity defect was confirmed during this audit: `verify-iap-receipt` explicitly trusts client-supplied purchase details instead of validating them with Apple or Google, then uses the service role to grant Pro or storage entitlements. This must be addressed before delegating unsupervised operational ownership.

The concise conclusion is:

> The product is behaviourally well protected but structurally and operationally knowledge-heavy. A strong React/Supabase vendor can take it over, but should not accept full production responsibility until the critical IAP defect, reproducibility gaps, and quality-gate failures have owners and remediation plans.

## Audit boundaries

This was a repository-only assessment. It did not access or modify hosted development or production databases, Supabase dashboards, Stripe, Apple, Google Play, Firebase, Netlify, Codemagic, or live user data. Therefore the following require separate operational verification:

- branch protection and required GitHub checks;
- production RLS state versus checked-in migrations;
- enabled Edge Functions and their deployed `verify_jwt` settings;
- Supabase PITR, backup success, Realtime usage, and resource limits;
- active secrets, key rotation, and third-party dashboard ownership;
- Crashlytics delivery and web error-monitoring coverage;
- restore success from actual backup artifacts.

The worktree contained pre-existing uncommitted capacity/load-test material. It was preserved and was not treated as deployed production behaviour.

## Current scale and evidence

| Measure | Current repository evidence |
|---|---:|
| Frontend production TS/TSX | approximately 286,761 lines across 840 files |
| Production files over 500 lines | 139 |
| Production files over 1,000 lines | 55 |
| Largest frontend module | `VaultPage.tsx`, 5,708 lines |
| Direct Supabase client importers | approximately 458 files |
| Supabase query/table call sites | approximately 2,396 |
| Tracked migrations | 963 |
| Edge Function directories | 116; 115 tracked `index.ts` entry points |
| Edge Function TypeScript | approximately 36,032 lines |
| Frontend test files | 161 |
| Local/integration test files | 24 |
| Current complete baseline | 1,604 frontend + 12 Playwright + 123 local Supabase passed |
| Intentional frontend skips | 16 dependency-monitoring cases |
| Current lint result | 3,431 errors |
| Current TypeScript result | failed with Capacitor and test typing errors |
| Current npm audit | 22 findings: 21 high, 1 low, 0 critical |
| Current production build output | approximately 16 MB; largest JS chunks approximately 1.04 MB and 985 KB |

## Scorecard

| Area | Score | Assessment |
|---|---:|---|
| Behavioural test protection | **9.0/10** | Excellent breadth and a safe isolated backend baseline; a major handover asset |
| Architecture and modularity | **4.0/10** | Many very large modules combine UI, permissions, data access, Realtime, and business workflows |
| Type safety and static analysis | **3.0/10** | Strictness disabled; lint and type-check currently fail and cannot serve as gates |
| Database maintainability | **4.0/10** | Strong RLS focus, but a 963-file history and no canonical full rebuild remain major risks |
| Edge Function maintainability | **4.5/10** | Broad capability, but duplicated infrastructure, version drift, and incomplete compile/contract coverage |
| Application security | **5.0/10** | Good behavioural security testing, offset by the critical IAP defect and endpoint-governance gaps |
| CI/CD and release safety | **7.0/10** | Strong isolated baseline and destructive migration guard; promotion dependencies remain complex |
| Dependencies and supply chain | **5.0/10** | Active hardening work exists, but 22 audit findings and several constrained upgrade paths remain |
| Performance and scale readiness | **6.0/10** | Code splitting, virtualization, metrics, and local load tooling exist; bundle and query budgets do not |
| Observability and incident response | **6.0/10** | Crashlytics and custom telemetry exist; web exception aggregation and actionable SLOs are incomplete |
| Documentation and onboarding | **5.5/10** | Detailed handover material exists, but the README and several operational references are stale |
| Bus factor and ownership | **4.0/10** | Repository history is overwhelmingly bot-generated with one main human owner |

## Ranked findings

### Critical — resolve before unsupervised vendor ownership

#### C1. In-app purchases can grant paid entitlements without server receipt validation

`supabase/functions/verify-iap-receipt/index.ts` states that it trusts the client-side transaction. An authenticated user with an eligible administrative role can supply a fabricated `platform`, `transactionId`, `productId`, `entityId`, and `entityType`. The function then uses a service-role client to record the transaction and grant club Pro, team Pro, or storage capacity.

Additional defects compound the risk:

- `receipt` is not validated with Apple App Store Server API or Google Play Developer API;
- `platform` and transaction ownership are not verified;
- the request `entityType` is not required to match the product's configured entity type;
- renewal, cancellation, refund, and revocation truth are not server-driven;
- write errors from transaction insertion and entitlement updates are ignored;
- the transaction record and entitlement changes are not atomic;
- no focused tests were found for this Edge Function.

**Impact:** free or forged entitlement upgrades, incorrect storage allocation, inconsistent subscription state, revenue loss, and difficult reconciliation.

**Recommendation:** temporarily prevent unverified entitlement activation if this endpoint is live. Implement platform-specific server verification, validate product/entity/platform consistency, require transaction ownership, make processing idempotent, and move all writes into one transactional RPC. Add tests for forgery, replay, mismatched products, revoked purchases, partial failures, concurrency, and renewal/cancellation events.

### High — first 30 days

#### H1. Lint and TypeScript are not usable quality gates

`npm run lint -- --quiet` reports 3,431 errors. `npx tsc -p tsconfig.app.json --noEmit` fails in Capacitor configuration and multiple tests. `tsconfig.app.json` disables `strict`, `noImplicitAny`, unused checks, and fallthrough checks. A scan found approximately 3,621 occurrences of `any` across frontend and Edge Function TypeScript.

**Impact:** vendors cannot distinguish newly introduced defects from legacy noise, refactors lack compiler assistance, and CI cannot safely require either check.

**Recommendation:** do not attempt a mass cleanup. Establish a clean lint/type configuration for new and refactored modules, exclude archived code, fix the current finite type-check failures, then introduce ratcheting budgets that prevent new debt.

#### H2. The database cannot be reproduced from a clearly verified canonical source

The repository has 963 tracked migrations. The safe local suite uses a synthetic baseline, which is appropriate for isolated behavioural tests but does not prove that a vendor can rebuild the complete production schema from repository history.

**Impact:** high risk during disaster recovery, new environment creation, schema drift investigations, and vendor-led backend changes.

**Recommendation:** create a canonical schema baseline from an independently reviewed source, verify it in a fresh local project, then prove that every subsequent migration applies. Retain historical migrations until schema, RLS, functions, triggers, indexes, Realtime publications, storage policies, and seed requirements are independently compared.

#### H3. Edge Function authentication configuration lacks a single auditable contract

`supabase/config.toml` declares `verify_jwt = false` for 42 functions. Some are legitimately public, webhook, cron, or internally authenticated endpoints; others perform their own JWT/secret validation. The risk is not the flag alone, but the lack of a checked-in endpoint inventory proving the intended caller, authentication method, authorization rule, rate limit, and idempotency strategy for all 115 entry points.

**Impact:** a future function can be deployed publicly without an obvious review failure, and vendor reviewers must rediscover security assumptions function by function.

**Recommendation:** add an Edge Function manifest and a test that requires every function to declare `public`, `user_jwt`, `webhook_signature`, `cron_secret`, or `internal_secret`, plus its authorization and rate-limit policy. Fail CI when a function is missing from the manifest or its configuration disagrees.

#### H4. Privileged multi-step mutations are frequently non-transactional

The IAP function is a concrete high-impact example, and the Edge Function estate contains more than 400 insert/update/delete/upsert call sites. Many workflows use service-role clients and multiple sequential operations. The strong test suite covers selected transaction paths but not all privileged mutations.

**Impact:** partial state after network, constraint, or downstream failures; duplicate notifications/payments; difficult manual repair.

**Recommendation:** inventory service-role multi-write workflows. Prioritize payments, subscriptions, membership changes, destructive operations, invitations, scheduled messages, and notification fanout. Use transactional database RPCs for state transitions and an outbox/idempotency model for external side effects.

#### H5. Module size and direct Supabase coupling create high change cost

There are 139 production files over 500 lines and 55 over 1,000. Examples include:

- `VaultPage.tsx` — 5,708 lines;
- `AutoSubPlanDialog.tsx` — 5,269 lines;
- `EventDetailPage.tsx` — 4,210 lines;
- `AddTeamMemberSheet.tsx` — 3,817 lines;
- `PitchBoard.tsx` — 3,402 lines;
- `MessagesPage.tsx` — 3,338 lines;
- `HomePage.tsx` — 3,305 lines;
- `CompetitionFixturesPanel.tsx` — 2,701 lines.

Approximately 458 files import the Supabase client directly. UI components frequently own query construction, permissions, mutation sequencing, cache invalidation, Realtime lifecycle, and presentation.

**Impact:** slow onboarding, wide regression surfaces, duplicated rules, difficult reviews, and expensive vendor estimates.

**Recommendation:** introduce feature-level repositories/services and pure policy functions incrementally. Do not build one global generic API layer. Preserve component interfaces and extract one observable behaviour per pull request.

#### H6. Dependency findings require exposure-based ownership, not blanket overrides

The current lockfile audit reports 21 high and one low finding. Major groups are:

- React Router 7.18.1 advisory affecting RSC action handling;
- ExcelJS/Archiver/Glob/Minimatch/brace-expansion paths;
- ESLint/typescript-eslint build-tool paths;
- a low-severity Babel source-map file-read issue.

The application is a Vite SPA and does not appear to use React Router RSC actions, reducing practical exposure for that advisory. ExcelJS processes uploaded fixture workbooks, so resource-exhaustion and parser paths deserve more attention. ESLint-related paths are primarily developer/build-time. The existing brace-expansion accepted-risk document is directionally sound: forcing an incompatible global major override is unsafe.

**Recommendation:** maintain an advisory register with runtime reachability, input trust, compensating controls, owner, and review date. Upgrade parent packages only with the existing targeted regression suites. Do not use `npm audit fix --force` or chase a green count with unsafe global overrides.

#### H7. Release safety depends on process that is not fully enforced in code

The `codespaces-review` baseline and production destructive-migration guard are valuable. However, the repository alone does not prove that:

- `codespaces-review` checks are required before promotion to `prod`;
- direct pushes or alternate merge paths are blocked;
- production deploy waits for the exact tested commit;
- all Edge Functions parse/type-check before deployment;
- a failed backend deploy prevents every frontend/mobile release channel.

**Recommendation:** verify GitHub rulesets and require the complete baseline on the exact promotion commit. Protect `main`, `codespaces-review`, and `prod`; require reviewed PRs and status checks; prohibit force pushes; and add an Edge Function validation job before promotion.

#### H8. Backup coverage and restore confidence need operational proof

Nightly database dumps, schema backups, storage backups, and guarded restore workflows are positive. The restore workflow explicitly does not restore `auth.users`, and database and storage recovery are separate. There is no repository evidence of a recent successful full restore rehearsal. Documentation also suggests PITR status needs confirmation.

**Impact:** an apparent backup may not meet real RPO/RTO or restore identity/storage consistency during an incident.

**Recommendation:** confirm PITR on Supabase Pro, document actual RPO/RTO, run quarterly restore drills into an isolated project, verify row counts/checksums/login linkage/storage, and record evidence. Backups should be encrypted, access-controlled, and retained outside the same failure domain.

### Medium — next 30 to 90 days

#### M1. Edge Function dependency versions and shared infrastructure are fragmented

Functions import several Supabase client versions and Deno standard-library versions, including broad `@2` URLs and older `std@0.168.0`/`0.190.0`. Shared helpers cover only a portion of auth, Pro guards, and outbound controls.

**Recommendation:** use a central import map/lock strategy, pin reviewed versions, and standardize request parsing, CORS, authentication, errors, correlation IDs, idempotency, and rate limiting through tested shared helpers.

#### M2. Web error observability is incomplete

Native Crashlytics is initialized and custom web-vitals/performance telemetry exists. Web exceptions primarily reach console/error boundaries; the handover pack refers to Sentry even though no Sentry integration is present. Only a minority of Edge Functions visibly implement rate limiting, though not every endpoint requires it.

**Recommendation:** add centralized web exception reporting with release/commit tags, user/club-safe context, source maps, alert ownership, and PII scrubbing. Define SLOs for auth, event loads, chat delivery, push delivery, Edge Function failures, database saturation, and Realtime disconnects.

#### M3. Performance work is active but lacks enforceable budgets

The application uses route splitting, virtualization, web vitals, custom latency instrumentation, and local load tooling. The build still contains approximately 1 MB JavaScript chunks and a roughly 985 KB fixture-import chunk. There is no CI bundle budget or query-count/latency budget.

**Recommendation:** establish route-level bundle budgets, lazy-load ExcelJS/reporting dependencies, monitor p75 LCP/INP and Supabase request latency, and add query-count checks for the busiest screens. Use production telemetry to prioritize rather than optimizing every large file.

#### M4. Documentation is extensive but not canonical

The root README remains the generic Lovable README. `VENDOR_HANDOVER_PACK.md` references a missing `docs/PROMOTION.md`, mentions Sentry as an incident tool despite no integration, and contains items needing confirmation. Multiple documents contain stale test, migration, hosting, or scaling figures.

**Recommendation:** replace the root README with a canonical operator/developer entry point. Mark each document with owner and review date, remove stale duplication, and link one authoritative source for architecture, environment topology, deployment, rollback, data model, integrations, testing, and incidents.

#### M5. Bus factor and review independence are low

Recent history is overwhelmingly authored by the Lovable/gpt-engineer bot, with one main human contributor. No CODEOWNERS, ADR collection, or clear PR template was found.

**Recommendation:** require human review for permissions, migrations, payments, auth, and Edge Functions; add CODEOWNERS; record architectural decisions; and conduct a structured shadow period with the vendor. Generated code should be held to the same lint, type, test, and review standards as human code.

#### M6. Secrets and sensitive configuration need a formal inventory

A tracked `.env` contains Supabase URL/project/publishable-key variable names; those values are expected to be public-client configuration but should be explicitly documented as such. Firebase mobile configuration files are also tracked, which is normal when restricted correctly. Some Stripe secret material appears to have historical database compatibility paths.

**Recommendation:** maintain a secret inventory by environment and owner, confirm no service-role or private keys are tracked, enforce secret scanning, rotate credentials on ownership changes, and eliminate plaintext database secret fallbacks after a migration plan.

## Testing assessment

### What is already sufficient

The baseline is strong enough for staged refactoring of bounded features. It meaningfully protects:

- authentication and account recovery;
- roles, permissions, memberships, guardian relationships, and invitations;
- Free/Pro entitlements;
- event and recurring-series behaviour;
- club-wide targeting and RSVP grouping;
- notifications and selected messaging behaviour;
- Realtime isolation and lifecycle;
- storage permissions and signed URLs;
- competitions and selected game-day workflows;
- AutoSub fairness for common non-halftime-GK scenarios;
- Edge Function authentication guards;
- destructive migration detection;
- dependency-upgrade regression boundaries.

Adding broad low-value unit coverage is not the next priority.

### High-value gaps still worth adding

1. Apple/Google IAP verification, replay, revocation, concurrency, and transactional entitlement tests.
2. An all-Edge-Function parse/type/import validation job.
3. A checked-in Edge Function authentication/authorization manifest test.
4. Stripe webhook idempotency, out-of-order event, replay, and partial-write integration tests.
5. Canonical schema rebuild and post-baseline migration tests.
6. Backup restore rehearsal automation against a disposable project or Postgres instance.
7. Performance budgets for main chunks and high-traffic query counts.
8. Remaining AutoSub halftime-goalkeeper fairness scenarios, treated as a distinct planner project.

## Recommended refactoring sequence

Do not begin with authentication, global chat, `App.tsx`, or a schema rewrite. Those areas have high blast radius.

### First target: `CompetitionFixturesPanel.tsx`

This remains the best bounded structural target because it has meaningful behavioural tests and separable responsibilities.

1. Extract domain types and pure fixture/result transformations.
2. Extract permission/action-availability policies.
3. Extract feature-specific query and mutation functions.
4. Extract form validation and state transitions.
5. Split rendering components only after business/data boundaries exist.
6. Keep the public component interface and UI behaviour stable.
7. Run the one-click baseline after every reviewable extraction.

### Second target: payment and entitlement boundary

After the critical IAP fix, consolidate Stripe/IAP entitlement transitions behind transactional database functions and typed service contracts. This is risk reduction rather than cosmetic refactoring.

### Third target: Vault or event detail

Choose based on production incident/change frequency. Add only missing characterization tests before extraction. Separate permissions and mutation orchestration before splitting JSX.

## 30/60/90-day vendor-readiness plan

### Days 0–30: remove unacceptable risk

1. Fix server-side IAP verification and transactional entitlement processing.
2. Confirm whether the vulnerable endpoint is deployed and inspect historical IAP transactions for anomalies.
3. Make TypeScript check pass; create a legacy-aware lint baseline.
4. Add Edge Function parse/type validation and auth manifest.
5. Verify branch protections and exact-commit promotion gates.
6. Confirm PITR and complete a restore rehearsal.
7. Replace the root README and reconcile handover documents.
8. Assign owners for Supabase, Stripe, Apple/Google IAP, Firebase, Netlify, Codemagic, backups, and incidents.

### Days 31–60: reduce change cost

1. Refactor `CompetitionFixturesPanel` in small behaviour-preserving pull requests.
2. Establish strict TypeScript islands for new/refactored code.
3. Introduce feature-level data/service boundaries.
4. Standardize Edge Function request/auth/error/idempotency helpers.
5. Add dependency advisory ownership and review cadence.
6. Define operational SLOs and alerts.

### Days 61–90: prove independent ownership

1. Vendor leads a backend and frontend release using documented procedures.
2. Run database/storage restore and incident tabletop exercises.
3. Refactor a second bounded domain.
4. Enforce no-new-debt lint/type budgets.
5. Validate capacity assumptions with production telemetry and isolated load tests.
6. Sign off access, escalation, RPO/RTO, data retention, and compliance responsibilities.

## Suggested vendor team and onboarding expectation

Minimum responsible coverage:

- one senior React/TypeScript engineer;
- one engineer experienced with Supabase/Postgres/RLS and transactional design;
- access to Capacitor/iOS/Android release expertise;
- named DevOps/security ownership for CI, secrets, backups, and incidents.

One person may cover several roles, but a junior frontend-only vendor should not own this system alone.

Expected onboarding:

- **Week 1:** repository, domain, environments, tests, and release observation;
- **Weeks 2–3:** small changes and supervised releases;
- **Weeks 3–6:** ownership of a bounded domain and incident shadowing;
- **After evidence-based sign-off:** unsupervised operational ownership.

Until the first 30-day items are completed, expect routine changes to attract roughly a **1.3–1.6× investigation/review premium**, and backend/payment/migration work potentially **2× or more**, compared with a modular, strictly typed system with a canonical schema.

## Handover acceptance checklist

A vendor should not accept full responsibility until it can demonstrate:

- [ ] server-verified and replay-safe IAP entitlement processing;
- [ ] successful one-command isolated baseline execution;
- [ ] clean TypeScript gate and a no-new-lint-debt policy;
- [ ] documented Edge Function caller/auth matrix;
- [ ] reproducible canonical schema baseline;
- [ ] protected branches and required exact-commit checks;
- [ ] successful database and storage restore rehearsal;
- [ ] confirmed PITR/RPO/RTO and backup ownership;
- [ ] access to required operational dashboards without shared personal credentials;
- [ ] web and native error monitoring with named alert responders;
- [ ] current architecture, deployment, rollback, and incident runbooks;
- [ ] clear ownership for every third-party integration and credential;
- [ ] independent production release led by the vendor;
- [ ] incident tabletop completed and gaps recorded.

## Final recommendation

Proceed with vendor handover preparation, but use a staged transition rather than a simple repository transfer. The codebase has enough behavioural protection to support disciplined improvement; further indiscriminate test expansion is not the best use of effort. Immediate attention should go to the IAP defect, reproducibility, static quality gates, Edge Function governance, and operational proof. Once those controls are in place, bounded refactoring can materially lower ongoing vendor cost without a risky rewrite.
