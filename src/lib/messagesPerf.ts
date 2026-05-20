/**
 * Lightweight phase timing for MessagesPage cold-open diagnostics.
 *
 * Logs `[MsgPerf] <label> +<msSinceMount>ms (<phaseMs>ms)` via console.info.
 * Enable: localStorage `ff:msg-perf=1` OR URL `?msgPerf=1`. Otherwise no-op.
 *
 * Usage:
 *   const t = makeMsgPerfTimer();          // call once at mount
 *   t.mark('mount');
 *   const stop = t.start('teams.query');
 *   ... await fetch ...
 *   stop();
 *   t.mark('firstRender');
 */

function isEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const url = new URL(window.location.href);
    if (url.searchParams.get("msgPerf") === "1") return true;
    return window.localStorage?.getItem("ff:msg-perf") === "1";
  } catch {
    return false;
  }
}

export interface MsgPerfTimer {
  mark: (label: string) => void;
  start: (label: string) => () => void;
  enabled: boolean;
}

export function makeMsgPerfTimer(): MsgPerfTimer {
  const enabled = isEnabled();
  const t0 = performance.now();
  const log = (label: string, phaseMs?: number) => {
    const since = (performance.now() - t0).toFixed(0);
    if (phaseMs !== undefined) {
      // eslint-disable-next-line no-console
      console.info(`[MsgPerf] ${label} +${since}ms (${phaseMs.toFixed(0)}ms)`);
    } else {
      // eslint-disable-next-line no-console
      console.info(`[MsgPerf] ${label} +${since}ms`);
    }
  };
  if (enabled) log("mount-init");
  return {
    enabled,
    mark: (label: string) => {
      if (!enabled) return;
      log(label);
    },
    start: (label: string) => {
      if (!enabled) return () => {};
      const s = performance.now();
      log(`${label}:start`);
      return () => log(`${label}:end`, performance.now() - s);
    },
  };
}
