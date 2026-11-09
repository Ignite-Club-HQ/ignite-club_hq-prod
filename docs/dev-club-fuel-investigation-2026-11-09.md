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