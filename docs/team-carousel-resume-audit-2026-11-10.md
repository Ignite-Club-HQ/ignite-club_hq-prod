# Team carousel resume audit — DEV only

## Confirmed defects and repairs

1. **Cached cards prevented suspended-fetch recovery.** `createCarouselResumeRecovery` returned immediately whenever cards existed, including a background refresh suspended by Android. A second return also joined the recovery's already-suspended promise indefinitely. Two regressions reproduced these conditions before the repair (one no-refresh assertion failure, one timeout). Long background returns now restart just the observed inventory read, retain existing cards, and can release a previously suspended recovery. Short switches leave healthy requests alone; native/browser return signals coalesce.
2. **Trial badges blocked the entire ICP inventory.** Every team awaited its subscription before the carousel query could settle. A deliberately unresolved subscription timed out the new regression before repair. The carousel now reads core rows without trial subscriptions; a separate deferred, account-scoped query supplies the display-only badges. No entitlement or server permission check changed.
3. **League discovery repeated full-row reads.** `my_leagues` and club league listings already return complete rows filtered by server visibility; the loader discarded them and fetched every league again. Complete authorized rows are now reused, with a detail fallback for incomplete older DTOs. Server `my_leagues` and batch lookup both use `filter_visible_leagues`.
4. **Themed visits did not persist the canonical inventory.** The primary query hydrates from the all-club key, but successful themed visits wrote only a per-club snapshot. It now saves the full returned inventory under the canonical key as well as the visible scoped snapshot. Fetching/error results cannot renew the snapshot; inclusion of fetch state in the effect dependencies ensures successful settlement writes even when React Query retains the same array identity.
5. **Hidden clubs triggered supporting work.** Next-event, competition and trial enrichment now uses only selected-club teams/leagues and starts after initial render. Core discovery remains complete across authorized groups, so switching clubs does not require another inventory read. Event/competition query keys now also include the account.

## Findings deliberately left unchanged

- ICP Home already reveals independently of Next Up: the common reveal gate is not the present ICP blocker.
- Initial inventory still waits for authoritative team and league discovery; failed discovery still rejects rather than certifying an empty inventory.
- Role grants, group discovery, routing snapshots, deadlines and membership permissions remain in place. No consensus reads were converted to uncertified reads.
- Club metadata still loads as part of the card. Same-club metadata promises are already shared; team and subscription helpers already batch same-tick reads.
- Shared native adapter remains unchanged: plain resume is separate from genuine reconnect, chat recovery stays scoped, and suspended REST requests use its existing long-background threshold.
- The 12-second read deadline bounds coordination, not ICP transport cancellation. A discarded underlying ICP request may still finish, but it cannot commit its cancelled React Query result. Transport changes require separate measured evidence.
- No database, canister, sign-in, push, PROD configuration or deployment changes.

## Verification and limits

- Before repair: four new regressions failed, covering both suspended-refresh defects, trial blocking and redundant league lookups.
- After repair: 42 carousel/Home/Next Up checks pass in default email test configuration; 41 carousel/native-resume checks pass in ICP test configuration. Additional native-resume/reconnect checks passed in the earlier default run.
- Mounted carousel tests use the real QueryClient: authorized Team A remains visible while trial work is unresolved, Team B from another club is excluded, background refresh keeps cards visible, and canonical snapshots are written after settlement.
- Native listener tests cover 20 seconds away, simultaneous visibility/native signals, club-filter changes, and healthy one-second app switches.
- TEST preview reports build OK; desktop and 411×770 browser sign-in render with zero runtime errors and no horizontal overflow.
- These are deterministic failure reproductions, not measured phone speedups. The supplied session is `external_unmanaged`, with no authenticated TEST Internet Identity session or physical Android device. Paul's specific 20-second delay and real signed-in resume latency remain unverified. No promise of a numerical speedup or production fix is made.