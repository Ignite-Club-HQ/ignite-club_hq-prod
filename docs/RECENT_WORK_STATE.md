# Recent Work State — Ignite Club HQ

> Snapshot of the current branch/state so we don't rely on conversation memory.
> Last updated: 2026-07-21.

> **Superseded checkpoint:** This file is retained as July history and must not
> be treated as the current branch or release state. The current cumulative
> refactoring candidate is recorded in
> [`REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md`](REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md),
> and its outstanding review is
> [`testing/REFACTORING_MANUAL_ACCEPTANCE.md`](testing/REFACTORING_MANUAL_ACCEPTANCE.md).

## Active Session Context

- **Environment**: Dev has been cloned from prod and neutered.
- **Preview / published URLs**:
  - Preview: `https://id-preview--07e3017a-fabc-4c96-a9eb-f9d29146ffa6.lovable.app`
  - Published: `https://ignite-club-launchpad.lovable.app`
- **Build**: Vite + React 18 + TypeScript + Tailwind + Supabase + Capacitor.
- **Current user view**: `/index` (home page) on a mobile viewport (411×770 CSS px).

## Recently Completed Work

### 1. Cross-club event/team scope validation (Phase 1)
- **Status**: Implemented, warn-only, reversible.
- **Migration**: Created `public.validate_event_team_club_scope()` and `trg_validate_event_scope` on `public.events`.
- **Behavior**: Mismatched `events.team_id` ↔ `events.club_id` writes are allowed to succeed but log a `WARNING` and an `audit_logs` entry (`events_scope_warning`).
- **Rationale**: Zero existing mismatches in prod; observing for 3–7 days before hard-rejection Phase 2.
- **Next step**: Monitor `public.audit_logs` for `action = 'events_scope_warning'`, then flip to hard rejection if clean.

### 2. Realtime security hardening (Passes a–d) — COMPLETE
- **Audit**: `docs/REALTIME_MEMBERSHIP_AUDIT.md` documents all 30 `supabase.channel` instances.
- **Registry**: `src/lib/realtimeChannelRegistry.ts` centralises channel bookkeeping and automatic revocation.
- **Membership guard**: `src/hooks/useAuthorizedScopes.ts` provides a fail-closed membership snapshot and triggers `revokeScope` on loss.
- **Integration**:
  - `MessagesPage.tsx` inbox/bell callbacks now fail-closed.
  - All per-thread chat pages (`TeamChatPage`, `ClubChatPage`, `GroupChatPage`, `DirectMessagePage`, `ClubAdminChatPage`, `BroadcastChatPage`) register channels and clean up through the registry.
  - `useAuth` tears down all channels on `SIGNED_OUT` and cross-user `SIGNED_IN`.
- **Tests**: `src/lib/realtimeChannelRegistry.test.ts` (11 tests) and `src/hooks/useAuthorizedScopes.test.tsx` (17 tests) pass.
- **Risk**: No DB migrations or backend changes; fully reversible via History/revert.

### 3. Prior fixes still in place (selected)
- Auth hardening: passkey, password recovery, OTP, account recovery/deletion/export.
- `accept_guardian_parent_invite` RPC for transactional parent invite acceptance.
- Scheduled message cross-club entitlement leak fixed.
- Free-club chat defaults to 30 s polling (`useClubRealtimeMode`).
- Free-trial offer prioritisation patch for native purchases.
- Email unsubscribe audit completed; marketing/notification templates have unsubscribe paths.
- Performance instrumentation for home, schedule, inbox, and chat cold-open.

## Open Items / Next Decisions

1. **Cross-club validation Phase 2**: Decide when to flip from warn-only to hard rejection.
2. **Realtime smoke test**: Manually remove a user from a team in one session and verify the other session stops receiving Realtime payloads.
3. **Bundle/performance**: A 2.93 MB bundle regression was previously identified; lazy-loading and route prefetching were added but ongoing monitoring is advised.
4. **Dev vs prod data**: Dev uses synthetic users/clubs; prod uses real user data. Promotion process is documented in `docs/PROMOTION.md` and `docs/PROMOTION_CHECKLIST.md`.

## How to Pick Up This Work

- If returning after the dev session times out, check the latest commit on the current feature branch.
- Re-run the relevant test suites before any new changes:
  - `bunx vitest run src/lib/realtimeChannelRegistry.test.ts src/hooks/useAuthorizedScopes.test.tsx`
- For DB trigger changes, verify via the Supabase SQL editor or the next migration deploy.
- To deploy/promote, follow `docs/PROMOTION_CHECKLIST.md`.
