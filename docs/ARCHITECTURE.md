# Ignite Club HQ Architecture

**Status:** Authoritative engineering overview
**Last reviewed:** 2026-08-13

This document describes the repository architecture and the invariants a vendor
must preserve. Generated database types, migrations, runtime configuration, and
the lockfile remain authoritative where details differ.

## System context

Ignite Club HQ is a multi-tenant sports-club application delivered as a Vite
single-page app and wrapped by Capacitor for Android and iOS. The client talks to
Supabase for authentication, database access, realtime updates, storage, and
Edge Functions. Firebase/FCM supports native push; payment paths include web and
native purchase providers.

```text
Web / Android / iOS client
        |
        +-- Supabase Auth
        +-- Postgres APIs protected by RLS
        +-- Realtime subscriptions
        +-- Private/public Storage policies
        +-- Edge Functions --> email, push, payments, scheduled integrations
```

External dashboards and secrets are not represented completely in Git. Their
current configuration must be verified during vendor access transfer.

## Frontend boundaries

- `src/pages` owns route-level composition. Pages should not become repositories
  for reusable business rules.
- `src/features` is the preferred home for feature contracts, query/mutation
  adapters, and orchestration. Current extracted areas include competitions,
  events, membership, messaging, vault, and club links.
- `src/components` owns presentational and interactive UI. Feature directories
  may compose feature hooks but should not recreate permission logic.
- `src/hooks` contains shared hooks and legacy feature logic. New code should use
  an existing feature boundary or create one deliberately.
- `src/integrations/supabase` owns the browser client and generated schema types.
  Do not hand-edit generated types.

TanStack Query is the principal server-state layer. Query keys are part of the
application contract: club, team, thread, event, and user scope must be present
where relevant. Mutations must invalidate or update the same canonical keys used
by their readers. Realtime payloads must be scoped and reconciled without
revealing data from another club or chat.

## Backend boundaries

- `supabase/migrations` is the hosted schema history. Changes are forward-only
  and pass a destructive-migration guard before promotion.
- `supabase/functions` contains deployable Edge Functions. Authorization must be
  enforced server-side; a disabled JWT gateway check does not remove the need
  for explicit authentication and role/scope checks inside the function.
- Database RLS, functions, triggers, and constraints are the security and
  integrity boundary. Hidden UI controls are not authorization.
- `local-supabase-workspace` is a separate synthetic test schema. It is not a
  production snapshot and must never be promoted.

## Core data and security invariants

Every change should preserve these behaviours:

1. A user sees and mutates only clubs, teams, children, threads, events, media,
   and competition records permitted by their active memberships and roles.
2. Club and team roles are scoped; an elevated role in one club must not grant
   access in another.
3. Free/Pro decisions use the entitlement for the exact club and fail closed
   when entitlement state is missing or ambiguous.
4. Guardian access follows current child assignments. Removing one guardian
   must not remove another guardian's valid assignment.
5. Deleted/archived entities cannot leak into active selectors or cause a newly
   created team with the same display name to reuse an old chat identity.
6. Multi-step writes that represent one business operation must be atomic or
   have explicit, tested compensation and idempotency.
7. Notification recipients are resolved server-side, deduplicated, scoped, and
   processed in bounded batches without silently truncating large audiences.
8. Realtime subscriptions are registered before subscribe, cleaned up on scope
   change/unmount, and cannot inject records into the wrong scoped cache.
9. Private files use policy-protected paths or short-lived signed access; a UI
   URL alone is not proof of authorization.
10. Invite/deep-link routes retain their destination through cold start and
    authentication, then establish the correct active club context.

## Typical request flows

### Authenticated read

The route resolves session and active club context, a feature query constructs a
scope-complete key, Supabase applies RLS, and the result is rendered from query
state. On resume or reconnect, refreshes must be bounded rather than refetching
every active query indiscriminately.

### Business mutation

The UI validates input and calls a feature mutation/RPC/Edge Function. The
backend revalidates identity, role, scope, and data integrity. Success updates or
invalidates canonical caches; failure leaves a stable UI state and provides
human-readable feedback.

### Messaging and realtime

Thread identity and club scope are established before messages are revealed.
Initial history, reactions, unread state, and realtime events reconcile into one
thread-specific model. Notification navigation switches to the owning club and
lands on the referenced message without briefly exposing another thread.

### Notification delivery

A domain action creates durable notification intent/rows. Dispatch workers or
Edge Functions resolve eligible devices/preferences, batch delivery, and record
outcomes. Frontend rendering and push delivery are separate concerns and require
separate tests and monitoring.

## Test architecture

| Layer | Purpose |
| --- | --- |
| Unit/component | Pure rules, adapters, state transitions, UI contracts |
| Integration | Behaviour spanning queries/mutations, local RLS, Realtime, Storage, and Edge Functions |
| Playwright | Complete role-based journeys and routing/UX behaviour |
| Native harnesses | Android/iOS lifecycle, deep-link, keyboard, WebView, and resume risks |

The full local baseline is orchestrated by `scripts/run-complete-baseline.mjs`.
It uses only the disposable project under `local-supabase-workspace`. See
[Local Supabase security tests](testing/local-supabase.md).

## Known structural debt

- Several legacy pages/hooks remain large and mix orchestration, querying, and
  rendering. Continue extraction only where it reduces change coupling.
- Supabase access is still distributed across many frontend modules. Prefer
  feature-owned adapters and canonical query keys over a broad rewrite.
- TypeScript strict mode is not enabled globally, and explicit `any` remains
  common. The production-only compiler gate and stricter feature/workflow
  boundaries must remain green; tighten strict coverage incrementally.
- Migration and Edge Function volume makes promotion review expensive. Preserve
  forward-only migrations and keep shared Edge Function auth/response helpers
  small and tested.
- Native and third-party operational configuration is partly external to Git;
  maintain an access inventory and verify it during handover.

## Change rules

- Preserve behaviour with focused characterization tests before refactoring.
- Keep commits small enough to revert independently.
- Do not mix infrastructure, schema, dependency, and broad UI refactors in one
  promotion tranche.
- A frontend permission test does not replace an RLS or Edge authorization test.
- Update this document when ownership, data flow, or a security boundary changes.
