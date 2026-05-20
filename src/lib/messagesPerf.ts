/**
 * Lightweight phase timing for MessagesPage cold-open diagnostics.
 *
 * Logs `[MsgPerf] <label> +<msSinceMount>ms (<phaseMs>ms)` via console.info
 * AND emits events to subscribers (used by <MsgPerfOverlay/>).
 *
 * Enable: localStorage `ff:msg-perf=1` OR URL `?msgPerf=1`. Otherwise no-op.
 */

export function isMsgPerfEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const url = new URL(window.location.href);
    if (url.searchParams.get("msgPerf") === "1") return true;
    return window.localStorage?.getItem("ff:msg-perf") === "1";
  } catch {
    return false;
  }
}

export interface MsgPerfEvent {
  label: string;
  kind: "mark" | "start" | "end";
  sinceMountMs: number;
  phaseMs?: number;
}

const listeners = new Set<(e: MsgPerfEvent) => void>();
const recent: MsgPerfEvent[] = [];
const MAX_RECENT = 200;

function emit(e: MsgPerfEvent) {
  recent.push(e);
  if (recent.length > MAX_RECENT) recent.shift();
  listeners.forEach((l) => {
    try { l(e); } catch { /* ignore */ }
  });
}

export function subscribeMsgPerf(fn: (e: MsgPerfEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRecentMsgPerfEvents(): MsgPerfEvent[] {
  return recent.slice();
}

export function clearMsgPerfEvents() {
  recent.length = 0;
}

export interface MsgPerfTimer {
  mark: (label: string) => void;
  start: (label: string) => () => void;
  enabled: boolean;
}

// Shared time origin across all timers + global marks so events from
// MessagesPage and useAuth plot on the same axis in the overlay.
// performance.now() is navigation-relative; this captures the moment
// the module first loaded (very early in app boot).
const SHARED_T0 = (typeof performance !== "undefined") ? performance.now() : 0;

function logShared(label: string, kind: MsgPerfEvent["kind"], phaseMs?: number) {
  const sinceMountMs = performance.now() - SHARED_T0;
  if (phaseMs !== undefined) {
    // eslint-disable-next-line no-console
    console.info(`[MsgPerf] ${label} +${sinceMountMs.toFixed(0)}ms (${phaseMs.toFixed(0)}ms)`);
  } else {
    // eslint-disable-next-line no-console
    console.info(`[MsgPerf] ${label} +${sinceMountMs.toFixed(0)}ms`);
  }
  emit({ label, kind, sinceMountMs, phaseMs });
}

/**
 * Global mark/start usable outside of MessagesPage (e.g. useAuth).
 * Shares the same time origin as makeMsgPerfTimer so events line up
 * on a single timeline in MsgPerfOverlay.
 */
export function msgPerfMark(label: string): void {
  if (!isMsgPerfEnabled()) return;
  logShared(label, "mark");
}

export function msgPerfStart(label: string): () => void {
  if (!isMsgPerfEnabled()) return () => {};
  const s = performance.now();
  logShared(`${label}:start`, "start");
  return () => logShared(`${label}:end`, "end", performance.now() - s);
}

export function makeMsgPerfTimer(): MsgPerfTimer {
  const enabled = isMsgPerfEnabled();
  if (enabled) logShared("mount-init", "mark");
  return {
    enabled,
    mark: (label: string) => {
      if (!enabled) return;
      logShared(label, "mark");
    },
    start: (label: string) => {
      if (!enabled) return () => {};
      const s = performance.now();
      logShared(`${label}:start`, "start");
      return () => logShared(`${label}:end`, "end", performance.now() - s);
    },
  };
}
