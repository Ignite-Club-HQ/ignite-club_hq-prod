# ICP team carousel latency audit

## Result

The current implementation cannot guarantee instant first cards when its saved inventory is unavailable. It waits for the complete team **and** league inventory, including club display metadata, from every configured group before resolving the main carousel query. A slow unrelated league or group can therefore hide already-loaded teams. This is present in the PROD branch as well as DEV; production source was inspected read-only.

The supplied preview telemetry is an email session, not the affected Internet Identity phone session. This audit reproduces the software barriers with controlled reads; it does not establish the precise slowest request on Paul's installed phone.

## Confirmed barriers

### 1. All-or-nothing team/league result

`frontend/src/components/home/icpCarouselItems.ts` starts player leagues and role grants together, but ends with `await Promise.all([teams, leagues])`. Completed team rows remain inside the loader until leagues finish. Each team also waits on `getClubMeta(team.club_id)` before being added to the result.

Two deterministic tests reproduce this: a completed team remains withheld while either league discovery or club display metadata is pending. Releasing the pending read returns that same team. Optional trial reads were already removed from this initial path; that earlier repair does not address these barriers.

### 2. The primary inventory asks every group, not just the team's source

`MyTeamsPremiumCarousel.tsx:505–509` dispatches the combined loader as `competitions` with `{ everyGroup: true, merge: mergeLists }`. The loader itself reads club and mini-league services, not competition records.

When group routing is active, `groupDispatch.readAcross` asks shared services plus every registered group. `groupSession.readEveryGroup` waits for all group replies and then a fresh registry confirmation. Thus a group without the caller's teams may still delay their cards. The fan-out is parallel, not sequential, but first paint still equals the slowest participating leg plus confirmation.

Do not blindly change this to member-groups-only: player/guardian league access can exist without a club role. Team discovery and independent league discovery must be separated without losing those leagues or weakening destination authorization.

### 3. League visibility work is itself sequential

`backend/mini_league_domain/src/main.mo:301–307` loops through candidate leagues and awaits `verify_league_access` for each. `my_leagues` passes the complete league array. For non-admin/non-club-member callers, verification loops players and can await live guardian checks against club_domain.

This establishes a data-dependent latency path; the number and actual timing of relevant leagues/players on Paul's phone remain unmeasured. Authorization must be preserved in any bounded batching or indexing change.

### 4. Retry timing can exceed the reported delay

The main ICP query has a 12-second deadline and two retries, with 1- and 2-second delays. Three timed-out attempts alone can occupy approximately **39 seconds**. Group-leg coordination allows 15 seconds per leg and up to 25 seconds for the group aggregate, exceeding the outer 12-second deadline.

`withReadDeadline` races a promise; it does not cancel underlying canister operations. A retry can therefore start while previous routing/league work still runs. Existing same-tick batching does not deduplicate completed or already-running calls across retry attempts.

### 5. Saved-card availability is fragile

- `myTeamsCarouselCache.ts` removes snapshots after 24 hours. A deterministic test confirms yesterday's saved cards are discarded.
- The main ICP query explicitly opts out of IndexedDB persistence (`meta.persist = false`), making the localStorage snapshot its main synchronous restart fallback.
- The carousel clears all user snapshots when its query reaches `isError`, including transport timeouts, even if existing team cards were good.
- Snapshot writes wait until the complete ICP inventory stops fetching. Visiting Home and leaving before the slowest league/group finishes may save no cards for the next cold open.
- Local cache budgeting can evict disposable snapshots. Sign-out/account-switch and explicit membership/deletion invalidation intentionally clear them for privacy/correctness; those protections must remain.

### 6. What is not causing the primary delay

- ICP Home already reveals its sections once auth initializes; My Teams is not waiting for Next Up's whole-page reveal.
- Trial, photo, event and competition-name enrichment do not gate resolution of the main inventory query. Their traffic can compete with pending work, but they are not the all-or-nothing barrier described above.
- Cached cards remain visible during a healthy background refetch; existing tests cover this. The problem returns when no usable snapshot exists or the whole primary inventory is still pending.
- Existing resume recovery fixes cancellation of suspended observed queries; they do not make a cold complete inventory return progressively.

## Recommended repair, in order

1. Keep the same-account saved team shell visible immediately while revalidating; preserve deletion/account-switch clearing and distinguish transport failures from authoritative removal. Do not use cached `canManage` as authorization.
2. Split authorized team inventory from independent league inventory and club display enrichment. Publish confirmed teams without waiting for optional display fields or slow league discovery; do not persist partial results as a complete inventory or interpret failed sources as empty.
3. Route team reads through their verified membership sources, retaining a separate complete search for player-only leagues. Never bypass routing, admission, guardian or destination access checks to gain speed.
4. Align read deadlines/retry coordination so expired attempts do not multiply work; separate first-card readiness from complete-inventory success.
5. Optimize league visibility only if measured traces identify it as the remaining bottleneck; retain live guardian checks and bounded behavior.

**Instant** is realistic for a returning, still-signed-in member with saved cards. The first-ever visit has no genuine cards to render until its authorized team records arrive; promise fast progressive loading, not zero network latency.

## Verification

- Added `frontend/src/components/home/carouselLatencyAudit.test.ts`: three tests documenting the current blocking behavior, not tests claiming a fix.
- Default mode: 26 focused audit/inventory/mounted-resume/recovery tests passed.
- No runtime, canister, access-policy, email-mode, push or PROD data changes were made.
- Authenticated ICP phone timings and installed build identity remain unverified: this sandbox has neither Paul's delegated II session nor his device.