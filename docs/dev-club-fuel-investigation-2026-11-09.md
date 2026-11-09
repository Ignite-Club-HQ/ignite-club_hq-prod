# DEV-only club fuel experiment — 9 November 2026

## Scope and status

No deployed DEV or PROD canister, fuel balance, setting, membership, data or timer was changed. The new manual TEST workflow runs disposable actors on a local PocketIC instance on a native Linux GitHub worker. It cannot deploy to either application's services and uses no deployment secrets.

The sandbox host compatibility check failed: Linux 4.19.0-gvisor recovered a write fault but reported `writeBit: 0`; IC memory tracking requires `writeBit: 1`. The experiment stops before installation on this host. Both the disposable probe and unchanged club source compiled with moc 1.16.1. GitHub run **42551549182** on main source **4799770b56b876d8aa4af4f2ec1e5dcd0d1819c9** passed installation/tooling/compilation but stopped before measurement because the explicit application-subnet configuration omitted required `state.type`. Corrected to the library's `new` state; an actual installed-library encoding regression and fourteen existing checks now pass (15 total). Also sample idle time every 30 seconds: the compiler skips missed recurring expirations, so minute-only sampling cannot verify 40 directory callbacks. A fresh GitHub run must use these corrected bytes; there are still no runtime fuel results.

## Verified source behavior

- `club_domain/src/main.mo` schedules directory notifications every 30 seconds and name cleanup every 60 seconds, even when their callback bodies immediately return because there is no work. Daily deletion cleanup remains unchanged.
- `AccountAdmission.mo` and `RemovalReceiver.mo` do not own these timers. Prior descriptions attributing idle timers to those modules were imprecise.
- The actual compiler helper is [Motoko 1.16.1 `src/prelude/internals.mo`](https://github.com/dfinity/motoko/blob/1.16.1/src/prelude/internals.mo#L548-L638). When invoking a gathered timer callback throws, `reinsert` sets the global timer to `1` and reinserts a one-shot job with a past expiration. This establishes an immediate retry mechanism in the runtime, **not** that it caused PROD's historical fuel drain.

## Measurements

The experiment uses normal application-subnet cycle charging, pinned PocketIC 14.0.0 and moc 1.16.1:

1. Twenty simulated idle minutes: actual empty club Wasm, matched 30/60-second timer probe, and a no-timer probe. Installation and deliberate test fuel burns are excluded from observed cost.
2. Four deliberately low local balances on fresh disposable probes, each bounded to 80 rounds over eight simulated seconds after the first expiration, with a matched no-timer control.
3. Persist before/after cycles, callback counts, Wasm SHA-256, source/replica versions and errors. Refused measurements remain inconclusive; cost amplification is only a candidate, never causal proof.

The installed DEV/PROD services are not low-fuel test targets. No proposed service fix or deployment is authorized by this fixture's existence. Choose a repair only after usable runtime evidence; do not disable cleanup or weaken admission checks as a shortcut.

## Completed runtime evidence — 02:42 UTC

Corrected run [42552280176](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/42552280176) succeeded on main commit `993d364a6f340b0ed98a146ace2d49d0d01150e2`. Native host write-bit check passed; PocketIC 14.0.0 and moc 1.16.1 were used. Fifteen focused setup tests also passed locally. Measurements ran from 02:42:25–02:42:39 UTC and are synthetic, disposable-only evidence, not production activity.

| Twenty simulated idle minutes | Consumed cycles |
| --- | ---: |
| No-timer control | 1,976,200 |
| Matched 30/60-second timers | 1,247,957,161 |
| Unchanged empty club source | 1,253,040,541 |

The timer probe completed exactly 40 directory and 20 cleanup callbacks. This confirms recurring idle overhead in the tested empty club. A linear estimate for this same idle workload is about **0.0902T cycles/day** per empty club canister (`1,253,040,541 × 72`); it is not measured PROD consumption or a savings claim. Loaded state, settings, request traffic and subnet conditions differ.

Low-balance probes retained approximately 80–82 billion cycles after their setup calls, rather than the requested 2 million–2 billion: actual post-call balances, not requested retained amounts, define the observations. Over eight simulated seconds, timer/control consumption was respectively 403,833,454/0; 191,819,200/0; 10,092,800/0; and 0/0 cycles. All low-balance callback counts remained zero. The first three are cost-amplification candidates consistent with failed dispatch, not proof of historical PROD retry storms. The fourth made no progress: its automatic `no-amplification-observed` label must not be interpreted as healthy timer execution or absence of retries.

Probe Wasm SHA-256: `c2bc06be3ad10bc7a0760a949e51f6bd04cb778934f1ae4ea8fba13edb889ffa`.
Club Wasm SHA-256: `84ca87d034cfb4bb23ac846e87a05d62140f8a4194687d25a8d0d483ac26b374`.

**Decision:** do not change deployed timers, cleanup, admission or fuel settings based on these results. Normal idle timer overhead is measured locally; the historical production cause and a safe repair remain unverified. The missing diagnostic is a representative deployed balance/request/timer-failure observation window (including freezing reserve and runtime settings), or a disposable reproduction with equivalent state/settings and direct failed-dispatch evidence. No deployed service or production resource changed.