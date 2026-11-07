# Ignite DEV: login and home performance

## Scope and outcome

Implemented frontend-only improvements on DEV. No Production calls, deployments, permissions, canister changes, account linking changes or origin changes were performed. The existing native callback protocol and II expiry behavior remain intact.

These are critical-path changes, not shorter timeout values or hidden loading indicators. The requested 1/2/3/4-second mobile goals remain **unverified**, not promised.

## Confirmed causes

1. **Duplicate auth construction:** concurrent warm-up and silent resume constructed two auth clients. A regression reproduced two constructions before the repair and exactly one afterward.
2. **Unnecessary registration:** on devices without a local provisioned marker, returning accounts awaited `register_account`, an update, before profile loading. The deployed contract already provides caller-only `whoami` as a query. The new flow queries first, registering only after the exact `Unlinked identity` response. Revocation, erasure, removal and transport failures do not cause registration.
3. **Whole-inventory carousel barrier:** the loader withheld every card until all team subscriptions, club metadata and league discovery finished. A controlled regression reproduced zero early cards before the repair and an authorized first team while optional requests remain pending afterward.
4. **Optional role dependency:** profile loading awaited global roles although the auth context does not consume them. The auth-specific essential read omits `my_roles`; feature-specific permission readers remain unchanged.
5. **Duplicate profile reads:** concurrent requests could repeat profile retrieval and encrypted-name unlock. Reads now share only an in-flight promise for the same principal, target and read mode.
6. **Misleading timing:** previous milestones were navigation-relative and server reporting waited for the carousel. Measurements now include actual stage-to-stage intervals and report milestones independently. Sign-in resets all stages rather than mixing successive attempts.

## Changes by file/function

| File (under frontend/src unless stated) | Changes |
|---|---|
| `live/internetIdentityAuth.ts` — `getAuthClient`, `warmInternetIdentityAuthClient` | Single in-flight construction; complete target binding; discard stale constructions; preserve synchronous warmed popup call. |
| `live/internetIdentityAuth.ts` — `signInWithStoredSessionRecovery` | SDK session notifications wake recovery immediately; visibility/focus also wake it; fallback polling remains compatibility-only; listeners/timers clean up after completion or failure. |
| `live/internetIdentityAuth.ts` — provisioning and resume | Shared ongoing account check/resume; no persisted marker used as authority; retirement and target-change checks. |
| `live/ensureIdentityAccount.ts` | Exact-response query-before-registration policy, retaining existing canister linking/creation logic. |
| `live/identityTargetKey.ts` | Stable host/network/domain/canister binding for auth and in-flight reads. |
| `live/identityProfile.ts` — `fetchIcpIdentityProfile` | Coalesced principal/target-scoped reads; `essentialOnly` avoids global role fetch; late retired results cannot cache/disclose a profile. Encrypted-name authorization is retained. |
| `live/identityProfileCache.ts` | Reject mismatched account payloads and malformed profile records; no new entitlement cache. |
| `hooks/useAuth.tsx` — `IcpAuthProvider` | Verify restored identity matches stored principal before cache-backed readiness; use essential profile reads; timeout timers clean up; report failures/timeouts independently. |
| `hooks/useAuth.tsx` — Supabase provider paths | Lazy-load prefetch, passkey synchronization and push-subscription helpers at their existing call sites. Supabase behavior is retained; its client remains shared/eager elsewhere. |
| `components/home/icpCarouselItems.ts` | Emit authorized core team cards progressively; club branding/subscription metadata enrich later using the existing requests. Final inventory still rejects failures. |
| `components/MyTeamsPremiumCarousel.tsx` | Progressive items remain account/request/session-bound; incomplete inventories are not persisted. First-card measurement occurs after a double-animation-frame paint boundary. Fixed timing code referring to card arrays before their initialization. |
| `lib/perfStages.ts` | Stage deltas, independent batched reporting, timing-only redirect persistence and separate success/failure/timeout outcome records. Success means home first paint; full carousel completion remains separate. |
| `components/admin/SpeedComparisonCard.tsx` | Add identity→account, account→profile, identity→home, identity→first-team and attempt-outcome rows. |
| `frontend/AGENTS.md`, root `roadmap.md` | Record architectural constraints and verification status. |

## Requests eliminated, consolidated or deferred

- Returning login: one caller-bound account query replaces unnecessary registration update. First-time/unlinked login retains one registration update after the query. No mutations are automatically retried.
- Concurrent auth warm-up/resume: one client construction instead of two.
- Concurrent profile fetches: one profile/name-unlock read per account and complete target during the request, not a time-based authorization cache.
- Authentication profile: global `my_roles` request removed from this path. Existing feature role checks still run where needed.
- Carousel: existing batched team/subscription/club requests continue; authorized first cards no longer wait for subscription, branding or full league inventory.
- Existing team reads already coalesce into `get_teams` and subscriptions into `get_team_subscriptions`; home events already use shard-scoped `list_events_multi`. No unsafe global batching or routing shortcut was added.
- Supabase-only prefetch/passkey/push helpers are no longer directly imported by the shared auth module. This does not establish that all such code disappears from the built entry graph.

## Measurements and tests

**102 tests passed across 17 files**, covering:
- Existing vs first-time/unlinked registration; denial/network failure without registration.
- One shared auth construction; target change under an unchanged alias.
- Immediate successful SDK completion; validated stored-session notification recovery; invalid-session rejection and listener cleanup.
- Expired-session health vs transient delegation unavailability.
- Mobile redirect eligibility and fresh pending callback marker checks.
- Encrypted-name authorization, speculative-reference validation, retirement and account mismatch.
- Essential profile with a never-finishing optional role request; concurrent profile coalescing.
- Early authorized team before intentionally stalled optional reads; hidden team never emitted.
- Home membership/event freshness, logout, acknowledged-profile-save and layout routing regressions.
- Actual milestone deltas (e.g. identity at 10,000 ms and home at 11,200 ms produce **1,200 ms**, not 11,200 ms).

Phone-size DEV preview checked at **411 × 770**: both email and secure sign-in load, `Continue securely` is available, and **zero page runtime errors** were observed. Preview compilation reports **build OK**.

| Baseline | Before | After |
|---|---:|---:|
| Concurrent warm-up + resume construction (reproduced test) | 2 clients | 1 client |
| Returning-account registration policy (contract tests) | Update on an unmarked device | Query; 0 registration updates |
| Early card with optional reads held open (reproduced test) | 0 cards before completion | First authorized card before completion |
| Prior downloaded DEV main bundle | 1,646,253 bytes | Not measured for the new deployed build |
| Previously supplied device startup samples | Profile 2.7 s; home 7.6 s; first card 8.0 s; carousel 14.4 s (slow 52.4 s) | No new authenticated device sample |

The historical device timings use the older navigation-relative definitions and cannot be directly compared to the new identity-relative deltas. No synthetic duration is presented as real Android performance. No new median/p95 or target achievement is claimed.

## Remaining bottlenecks and acceptance limits

- The 10-second recovery poll was a race/fallback, not an unconditional 10-second sleep. SDK success already bypassed it; notifications now avoid the next 300-ms polling tick and improve cleanup. Slow real II authentication or an unresolved SDK channel still needs a device trace. It is not artificially cancelled while the user is authenticating.
- The 20/30-second warm-up and 45-second profile waits are failure bounds, not fixed delays. They were not shortened. Slow JS transfer, delegation minting and guarded private-name reads can still consume time.
- Encrypted own-name retrieval remains authorized and on the uncached profile resolution path; separating it further requires careful profile/onboarding acceptance, not substituting plaintext or removing key checks.
- Shared application imports still include Supabase, Firebase/native integrations and common UI. The 1.65-MB earlier main-bundle measurement is confirmed, but a new generated graph/byte comparison is unavailable. No full provider-module split or bundler network-waterfall claim is made.
- Progressive cards do not certify a complete inventory: slow or failed group/league reads remain visible through existing completion/error handling. They do not bypass membership checks.
- Failure/outcome traces are local even before authentication. Server analytics requires a valid caller and is best effort; failed sign-in without an authenticated session cannot be guaranteed to reach the admin dashboard. No anonymous analytics write endpoint was introduced.
- A real II delegation is not available to this sandbox. Supabase managed-session restoration cannot authenticate Internet Identity. Native browser redirects, fresh/reopened/expired real sessions, multi-club accounts and slow-network end-to-end acceptance require a real DEV account/device.
- No physical Android benchmark or authenticated home end-to-end run was completed. Public browser rendering and mocked service regressions are not substitutes.

## DEV device acceptance protocol

Use TEST only: `https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io` after its next DEV frontend delivery; deployed-byte verification remains outstanding for this batch.

1. Use existing returning member, first-time account and multi-club account; retain the same II identity/origin.
2. Exercise explicit login, phone callback, closed/reopened session and legitimately expired session.
3. Repeat normal mobile connection and slow-network conditions, recording successes, failures and timeouts separately.
4. In Admin → Placement settings → Speed, compare the new identity→account, identity→home and identity→first-team intervals. Record cold/cached conditions separately; do not compare old navigation-relative rows as identity-relative durations.
5. Verify club/team access, profile completion, invite/link paths and carousel membership after each account switch and logout.
6. Collect sufficiently many real runs for median/p95 and the requested goals before considering a Production release. Production remains untouched and unapproved.