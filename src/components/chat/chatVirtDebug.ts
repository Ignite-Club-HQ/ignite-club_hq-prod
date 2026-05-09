/**
 * Runtime instrumentation for the virtualised chat list.
 *
 * Disabled by default. Enable in any environment with one of:
 *   - URL param      `?chatVirtDebug=1`
 *   - localStorage   `ff:chat-virt-debug` = `1`
 *   - global         `window.__chatVirtDebug = true`
 *
 * Once enabled, the following are emitted to the console (grouped under
 * `[chat-virt]`) and buffered in-memory for post-hoc inspection via
 * `window.__chatVirtDebugDump()`:
 *
 *  - row height measurements      → estimated vs measured per row, with
 *                                    a delta + warning when |delta| > 24px
 *                                    (the dominant cause of visible jolts).
 *  - key stability                → re-render count per message id; warns
 *                                    on excessive churn (>20 renders / 5s
 *                                    for the same id) which usually means
 *                                    a parent closure is invalidating
 *                                    `itemContent` and the row is being
 *                                    re-mounted instead of re-used.
 *  - re-anchoring events          → anchor base id swaps, firstItemIndex
 *                                    deltas, bottom-pin revisions.
 *  - scrollTop ownership conflicts → any mutation of `scrollTop` on the
 *                                    Virtuoso scroller from outside the
 *                                    Virtuoso write path (e.g. a legacy
 *                                    chat hook still imperatively pinning).
 *
 * The instrumentation is intentionally cheap when disabled (a single
 * boolean check on the hot path) so it can ship to production behind the
 * `chatVirtDebug` flag for field debugging.
 */

const BUFFER_LIMIT = 500;

type DebugEvent = {
  t: number;
  kind:
    | "measure"
    | "key-churn"
    | "anchor"
    | "first-index"
    | "pin"
    | "scrolltop-write"
    | "start-reached"
    | "duplicate-id";
  data: Record<string, unknown>;
};

declare global {
  interface Window {
    __chatVirtDebug?: boolean;
    __chatVirtDebugDump?: () => DebugEvent[];
    __chatVirtDebugClear?: () => void;
    __chatVirtDebugBuffer?: DebugEvent[];
  }
}

let cachedEnabled: boolean | null = null;

export function isChatVirtDebugEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") {
    cachedEnabled = false;
    return false;
  }
  try {
    if (window.__chatVirtDebug === true) {
      cachedEnabled = true;
    } else if (
      typeof window.location !== "undefined" &&
      new URLSearchParams(window.location.search).get("chatVirtDebug") === "1"
    ) {
      cachedEnabled = true;
    } else if (window.localStorage?.getItem("ff:chat-virt-debug") === "1") {
      cachedEnabled = true;
    } else {
      cachedEnabled = false;
    }
  } catch {
    cachedEnabled = false;
  }
  if (cachedEnabled) initRuntime();
  return cachedEnabled;
}

function initRuntime() {
  if (typeof window === "undefined") return;
  if (!window.__chatVirtDebugBuffer) window.__chatVirtDebugBuffer = [];
  window.__chatVirtDebugDump = () => window.__chatVirtDebugBuffer ?? [];
  window.__chatVirtDebugClear = () => {
    if (window.__chatVirtDebugBuffer) window.__chatVirtDebugBuffer.length = 0;
  };
  // eslint-disable-next-line no-console
  console.info(
    "[chat-virt] debug instrumentation enabled — call __chatVirtDebugDump() to inspect events",
  );
}

function push(event: DebugEvent) {
  if (typeof window === "undefined") return;
  const buf = window.__chatVirtDebugBuffer;
  if (!buf) return;
  buf.push(event);
  if (buf.length > BUFFER_LIMIT) buf.splice(0, buf.length - BUFFER_LIMIT);
}

function log(level: "log" | "warn", label: string, payload: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console[level](`[chat-virt] ${label}`, payload);
}

// ─── row height measurements ──────────────────────────────────────────────
const measuredOnce = new Set<string>();

export function debugLogMeasure(
  messageId: string,
  estimated: number | undefined,
  measured: number,
) {
  if (!isChatVirtDebugEnabled()) return;
  // De-noise: only log first measurement (mount) per id; later remeasures
  // get logged only when they differ materially from the first one.
  const key = `${messageId}`;
  const firstTime = !measuredOnce.has(key);
  measuredOnce.add(key);
  const delta = estimated == null ? null : measured - estimated;
  const big = delta != null && Math.abs(delta) > 24;
  if (!firstTime && !big) return;
  push({ t: Date.now(), kind: "measure", data: { messageId, estimated, measured, delta } });
  if (big) log("warn", "row height drift", { messageId, estimated, measured, delta });
}

// ─── key stability ────────────────────────────────────────────────────────
const renderCounts = new Map<string, { count: number; firstAt: number }>();
const churnWarned = new Set<string>();

export function debugTrackRender(messageId: string) {
  if (!isChatVirtDebugEnabled()) return;
  const now = Date.now();
  const entry = renderCounts.get(messageId);
  if (!entry) {
    renderCounts.set(messageId, { count: 1, firstAt: now });
    return;
  }
  // 5s rolling window
  if (now - entry.firstAt > 5000) {
    entry.count = 1;
    entry.firstAt = now;
    return;
  }
  entry.count += 1;
  if (entry.count > 20 && !churnWarned.has(messageId)) {
    churnWarned.add(messageId);
    push({
      t: now,
      kind: "key-churn",
      data: { messageId, renders: entry.count, windowMs: now - entry.firstAt },
    });
    log("warn", "row key churn — likely itemContent identity instability", {
      messageId,
      renders: entry.count,
    });
  }
}

// ─── anchor / first-index / pin events ────────────────────────────────────
export function debugLogAnchor(reason: string, data: Record<string, unknown>) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "anchor", data: { reason, ...data } });
  log("log", `anchor: ${reason}`, data);
}

let lastFirstItemIndex: number | null = null;
export function debugLogFirstItemIndex(firstItemIndex: number, messagesLen: number) {
  if (!isChatVirtDebugEnabled()) return;
  if (lastFirstItemIndex === firstItemIndex) return;
  const delta = lastFirstItemIndex == null ? 0 : firstItemIndex - lastFirstItemIndex;
  push({
    t: Date.now(),
    kind: "first-index",
    data: { firstItemIndex, delta, messagesLen },
  });
  log("log", "firstItemIndex shift", { firstItemIndex, delta, messagesLen });
  lastFirstItemIndex = firstItemIndex;
}

export function debugLogBottomPin(revision: number, reason: string) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "pin", data: { revision, reason } });
  log("log", "bottom-pin", { revision, reason });
}

export function debugLogStartReached(accepted: boolean, reason: string) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "start-reached", data: { accepted, reason } });
  log("log", `startReached ${accepted ? "accepted" : "rejected"}`, { reason });
}

export function debugLogDuplicate(messageId: string, count: number) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "duplicate-id", data: { messageId, count } });
  log("warn", "duplicate message id filtered before virtualiser", { messageId, count });
}

// ─── scrollTop ownership conflicts ────────────────────────────────────────
const watchedScrollers = new WeakSet<HTMLElement>();
let virtuosoWriteDepth = 0;

/**
 * Wrap any external scrollTop mutation that *legitimately* belongs to
 * Virtuoso (scrollToIndex, scrollToBottom, etc.) so the watcher does not
 * mis-flag it as a foreign owner. Currently unused but exposed for tests.
 */
export function withVirtuosoScrollWrite<T>(fn: () => T): T {
  virtuosoWriteDepth += 1;
  try {
    return fn();
  } finally {
    virtuosoWriteDepth -= 1;
  }
}

export function debugAttachScrollerWatcher(element: HTMLElement | Window | null) {
  if (!isChatVirtDebugEnabled()) return;
  if (!element || element instanceof Window) return;
  if (watchedScrollers.has(element)) return;
  watchedScrollers.add(element);

  // Patch scrollTop setter on this instance only. We can't redefine on the
  // prototype (would affect every element); per-instance defineProperty is
  // safe and tearable when the element is GC'd.
  const proto = Object.getPrototypeOf(element);
  const desc =
    Object.getOwnPropertyDescriptor(proto, "scrollTop") ||
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  if (!desc?.set || !desc.get) return;
  const origSet = desc.set;
  const origGet = desc.get;

  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get() {
      return origGet.call(this);
    },
    set(value: number) {
      const before = origGet.call(this) as number;
      origSet.call(this, value);
      // Only flag *foreign* writes — internal Virtuoso writes are common
      // and expected. Our heuristic: if the call stack does not contain
      // any virtuoso frame and we're not inside withVirtuosoScrollWrite,
      // treat it as a foreign owner.
      if (virtuosoWriteDepth > 0) return;
      const stack = new Error().stack ?? "";
      if (/virtuoso/i.test(stack)) return;
      // Ignore tiny rebound writes the browser itself may issue.
      if (Math.abs(value - before) < 2) return;
      push({
        t: Date.now(),
        kind: "scrolltop-write",
        data: {
          from: before,
          to: value,
          delta: value - before,
          stack: stack.split("\n").slice(2, 6).join(" | "),
        },
      });
      log("warn", "foreign scrollTop write on virtuoso scroller", {
        from: before,
        to: value,
        delta: value - before,
      });
    },
  });
}
