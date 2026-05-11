/**
 * Lightweight runtime diagnostics for chat performance / freeze investigations
 * (Android WebView in particular).
 *
 * Enable in any environment with ONE of:
 *   - URL param     `?chatPerfDiag=1`
 *   - localStorage  `ff:chat-perf-diag` = `1`
 *   - global        `window.__chatPerfDiag = true`
 *
 * When enabled at module-load time we monkey-patch `ResizeObserver` and
 * `supabase.channel` / `supabase.removeChannel` to keep live counts so we
 * can see whether per-thread observers / realtime channels are leaking
 * across thread switches. We also install a `PerformanceObserver` for the
 * `longtask` entry type so any main-thread block >50 ms shows up in the
 * buffer with a timestamp + duration.
 *
 * Disabled-state cost is a single boolean check; nothing is patched and
 * nothing is observed. Safe to ship behind the flag.
 *
 * Surface in `AdminChatVirtDebugPage` via `getChatPerfSnapshot()`.
 */

const PERF_BUFFER_LIMIT = 200;
const PERF_STORAGE_KEY = "ff:chat-perf-diag-state";
const PERF_SAVE_THROTTLE_MS = 1000;

type PerfEvent =
  | { t: number; kind: "mount"; name: string; id?: string | null }
  | { t: number; kind: "unmount"; name: string; id?: string | null; lifetimeMs: number }
  | { t: number; kind: "longtask"; durationMs: number; startTime: number }
  | { t: number; kind: "channel-add"; topic: string }
  | { t: number; kind: "channel-remove"; topic: string }
  | { t: number; kind: "freeze"; stallMs: number; activePages: string; source: "heartbeat" | "raf" | "manual"; note?: string };

type ChatPerfState = {
  enabled: boolean;
  installed: boolean;
  liveResizeObservers: number;
  totalResizeObserversCreated: number;
  liveChannels: Map<string, number>; // topic → count
  totalChannelsCreated: number;
  totalChannelsRemoved: number;
  liveChatPages: Map<string, number>; // chat name → live count
  mounts: Map<string, number>; // mountKey → t0
  events: PerfEvent[];
};

declare global {
  // eslint-disable-next-line no-var
  var __chatPerfDiag: boolean | undefined;
  // eslint-disable-next-line no-var
  var __chatPerfState: ChatPerfState | undefined;
  interface Window {
    __chatPerfDiag?: boolean;
    __chatPerfState?: ChatPerfState;
    __chatPerfDump?: () => ChatPerfState;
  }
}

function readEnabledFlag(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__chatPerfDiag === true) return true;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("chatPerfDiag") === "1") {
      try {
        window.localStorage.setItem("ff:chat-perf-diag", "1");
      } catch {}
      return true;
    }
    if (window.localStorage.getItem("ff:chat-perf-diag") === "1") return true;
  } catch {}
  return false;
}

function loadPersistedState(): Partial<ChatPerfState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      totalResizeObserversCreated: parsed.totalResizeObserversCreated ?? 0,
      totalChannelsCreated: parsed.totalChannelsCreated ?? 0,
      totalChannelsRemoved: parsed.totalChannelsRemoved ?? 0,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return null;
  }
}

let savePending = false;
let lastSaveAt = 0;
function persistState(state: ChatPerfState) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (savePending) return;
  const elapsed = now - lastSaveAt;
  const delay = Math.max(0, PERF_SAVE_THROTTLE_MS - elapsed);
  savePending = true;
  setTimeout(() => {
    savePending = false;
    lastSaveAt = Date.now();
    try {
      window.localStorage.setItem(
        PERF_STORAGE_KEY,
        JSON.stringify({
          totalResizeObserversCreated: state.totalResizeObserversCreated,
          totalChannelsCreated: state.totalChannelsCreated,
          totalChannelsRemoved: state.totalChannelsRemoved,
          events: state.events.slice(-PERF_BUFFER_LIMIT),
        }),
      );
    } catch {}
  }, delay);
}

function getOrInitState(): ChatPerfState {
  if (typeof window === "undefined") {
    return {
      enabled: false,
      installed: false,
      liveResizeObservers: 0,
      totalResizeObserversCreated: 0,
      liveChannels: new Map(),
      totalChannelsCreated: 0,
      totalChannelsRemoved: 0,
      liveChatPages: new Map(),
      mounts: new Map(),
      events: [],
    };
  }
  if (!window.__chatPerfState) {
    const persisted = loadPersistedState();
    window.__chatPerfState = {
      enabled: false,
      installed: false,
      liveResizeObservers: 0,
      totalResizeObserversCreated: persisted?.totalResizeObserversCreated ?? 0,
      liveChannels: new Map(),
      totalChannelsCreated: persisted?.totalChannelsCreated ?? 0,
      totalChannelsRemoved: persisted?.totalChannelsRemoved ?? 0,
      liveChatPages: new Map(),
      mounts: new Map(),
      events: persisted?.events ?? [],
    };
  }
  return window.__chatPerfState!;
}

function pushEvent(state: ChatPerfState, e: PerfEvent) {
  state.events.push(e);
  if (state.events.length > PERF_BUFFER_LIMIT) {
    state.events.splice(0, state.events.length - PERF_BUFFER_LIMIT);
  }
  persistState(state);
}

function patchResizeObserver(state: ChatPerfState) {
  if (typeof window === "undefined") return;
  const Original = window.ResizeObserver;
  if (!Original || (Original as any).__chatPerfPatched) return;

  class PatchedResizeObserver extends Original {
    private _disposed = false;
    constructor(cb: ResizeObserverCallback) {
      super(cb);
      state.liveResizeObservers += 1;
      state.totalResizeObserversCreated += 1;
    }
    disconnect(): void {
      if (!this._disposed) {
        this._disposed = true;
        state.liveResizeObservers = Math.max(0, state.liveResizeObservers - 1);
      }
      super.disconnect();
    }
  }
  (PatchedResizeObserver as any).__chatPerfPatched = true;
  window.ResizeObserver = PatchedResizeObserver as unknown as typeof ResizeObserver;
}

function installLongTaskObserver(state: ChatPerfState) {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const supported = (PerformanceObserver as any).supportedEntryTypes as string[] | undefined;
    if (supported && !supported.includes("longtask")) return;
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue;
        pushEvent(state, {
          t: Date.now(),
          kind: "longtask",
          durationMs: Math.round(entry.duration),
          startTime: Math.round(entry.startTime),
        });
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    // Browser doesn't support it (Safari/iOS WebView). Ignore.
  }
}

/**
 * Heartbeat-based main-thread freeze detector. We schedule a setInterval at
 * `HEARTBEAT_MS`; if the actual gap between ticks exceeds
 * `HEARTBEAT_MS + FREEZE_THRESHOLD_MS`, the JS thread was blocked for
 * roughly that overage. Catches blocks PerformanceObserver longtask misses
 * on Android WebView (e.g. layout/composite stalls during scroll), and
 * stamps each freeze with the currently-mounted chat page names so we can
 * see which screen the user was on when the app froze.
 */
const HEARTBEAT_MS = 250;
const FREEZE_THRESHOLD_MS = 200;
const RAF_FREEZE_THRESHOLD_MS = 250;

function activePagesString(state: ChatPerfState): string {
  return (
    Array.from(state.liveChatPages.entries())
      .filter(([, c]) => c > 0)
      .map(([name, c]) => `${name}:${c}`)
      .join(",") || "none"
  );
}

const WATCHDOG_KEY = "ff:chat-perf-watchdog";
const WATCHDOG_INTERVAL_MS = 1000;

type WatchdogTick = {
  ts: number; // Date.now() of last successful tick
  perfNow: number; // performance.now() at tick
  heapMB?: number;
  heapLimitMB?: number;
  activePages: string;
  url: string;
};

function writeWatchdog(state: ChatPerfState) {
  if (typeof window === "undefined") return;
  let heapMB: number | undefined;
  let heapLimitMB: number | undefined;
  try {
    const mem = (performance as any).memory;
    if (mem?.usedJSHeapSize) heapMB = Math.round(mem.usedJSHeapSize / 1048576);
    if (mem?.jsHeapSizeLimit) heapLimitMB = Math.round(mem.jsHeapSizeLimit / 1048576);
  } catch {}
  const tick: WatchdogTick = {
    ts: Date.now(),
    perfNow: Math.round(performance.now()),
    heapMB,
    heapLimitMB,
    activePages: activePagesString(state),
    url: typeof window !== "undefined" ? window.location.pathname : "",
  };
  try {
    window.localStorage.setItem(WATCHDOG_KEY, JSON.stringify(tick));
  } catch {}
}

function checkWatchdogOnStartup(state: ChatPerfState) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(WATCHDOG_KEY);
    if (!raw) return;
    const last: WatchdogTick = JSON.parse(raw);
    const gap = Date.now() - last.ts;
    // If last tick was >5s ago, the previous session likely hung (or was killed).
    if (gap >= 5000) {
      pushEvent(state, {
        t: last.ts,
        kind: "freeze",
        stallMs: gap,
        activePages: last.activePages || "none",
        source: "manual",
        note: `pre-kill watchdog: last tick ${gap}ms ago, heap ${last.heapMB ?? "?"}/${last.heapLimitMB ?? "?"}MB on ${last.url}`,
      });
    }
  } catch {}
}

function installWatchdog(state: ChatPerfState) {
  if (typeof window === "undefined") return;
  checkWatchdogOnStartup(state);
  writeWatchdog(state);
  setInterval(() => writeWatchdog(state), WATCHDOG_INTERVAL_MS);
}

function installFreezeDetector(state: ChatPerfState) {
  if (typeof window === "undefined") return;

  // 1) JS heartbeat — catches synchronous main-thread blocks.
  //    Skipped when document.hidden because OS throttles setInterval and
  //    would otherwise emit phantom "freezes" of ~1000ms.
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    if (typeof document !== "undefined" && document.hidden) return;
    const stall = gap - HEARTBEAT_MS;
    if (stall >= FREEZE_THRESHOLD_MS) {
      pushEvent(state, {
        t: Date.now(),
        kind: "freeze",
        stallMs: Math.round(stall),
        activePages: activePagesString(state),
        source: "heartbeat",
      });
    }
  }, HEARTBEAT_MS);

  // 2) requestAnimationFrame gap — catches *paint/compositor* freezes that
  //    the JS heartbeat misses (Android WebView scroll/layout stalls where
  //    JS keeps running but the screen is locked). If two consecutive rAFs
  //    are >RAF_FREEZE_THRESHOLD_MS apart while visible, log it.
  let lastRaf = performance.now();
  const tick = () => {
    const now = performance.now();
    const gap = now - lastRaf;
    lastRaf = now;
    if (
      gap >= RAF_FREEZE_THRESHOLD_MS &&
      (typeof document === "undefined" || !document.hidden)
    ) {
      // De-dupe with heartbeat: if last event in buffer is already a freeze
      // within 500ms, skip — same incident.
      const lastEv = state.events[state.events.length - 1];
      const isDup =
        lastEv &&
        lastEv.kind === "freeze" &&
        Date.now() - lastEv.t < 500;
      if (!isDup) {
        pushEvent(state, {
          t: Date.now(),
          kind: "freeze",
          stallMs: Math.round(gap),
          activePages: activePagesString(state),
          source: "raf",
        });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Initialise the diagnostics. Safe to call many times — only patches once.
 * Should be invoked once at app startup (e.g. from `main.tsx`).
 */
export function setupChatPerfDiagnostics(): void {
  const state = getOrInitState();
  if (state.installed) return;
  state.enabled = readEnabledFlag();
  if (!state.enabled) return;

  patchResizeObserver(state);
  installLongTaskObserver(state);
  installFreezeDetector(state);
  installWatchdog(state);
  state.installed = true;

  if (typeof window !== "undefined") {
    window.__chatPerfDump = () => getOrInitState();
    // eslint-disable-next-line no-console
    console.info("[chat-perf-diag] enabled — call window.__chatPerfDump() for snapshot");
  }
}

export function isChatPerfDiagEnabled(): boolean {
  return getOrInitState().enabled;
}

/** Note that a chat page has mounted. Returns the mount key for unmount. */
export function noteChatMount(name: string, id?: string | null): string {
  const state = getOrInitState();
  if (!state.enabled) return "";
  const key = `${name}:${id ?? ""}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
  state.mounts.set(key, performance.now());
  state.liveChatPages.set(name, (state.liveChatPages.get(name) ?? 0) + 1);
  pushEvent(state, { t: Date.now(), kind: "mount", name, id });
  return key;
}

export function noteChatUnmount(name: string, mountKey: string, id?: string | null): void {
  const state = getOrInitState();
  if (!state.enabled || !mountKey) return;
  const t0 = state.mounts.get(mountKey);
  state.mounts.delete(mountKey);
  state.liveChatPages.set(name, Math.max(0, (state.liveChatPages.get(name) ?? 1) - 1));
  pushEvent(state, {
    t: Date.now(),
    kind: "unmount",
    name,
    id,
    lifetimeMs: t0 ? Math.round(performance.now() - t0) : -1,
  });
}

/** Track realtime channel lifecycle. Call from chat pages where channels are subscribed. */
export function noteChannelSubscribed(topic: string): void {
  const state = getOrInitState();
  if (!state.enabled) return;
  state.liveChannels.set(topic, (state.liveChannels.get(topic) ?? 0) + 1);
  state.totalChannelsCreated += 1;
  pushEvent(state, { t: Date.now(), kind: "channel-add", topic });
}

export function noteChannelRemoved(topic: string): void {
  const state = getOrInitState();
  if (!state.enabled) return;
  const next = (state.liveChannels.get(topic) ?? 0) - 1;
  if (next <= 0) state.liveChannels.delete(topic);
  else state.liveChannels.set(topic, next);
  state.totalChannelsRemoved += 1;
  pushEvent(state, { t: Date.now(), kind: "channel-remove", topic });
}

export function markChatPerfFreeze(note?: string): void {
  const state = getOrInitState();
  if (!state.enabled) return;
  pushEvent(state, {
    t: Date.now(),
    kind: "freeze",
    stallMs: 0,
    activePages: Array.from(state.liveChatPages.entries())
      .filter(([, c]) => c > 0)
      .map(([name, c]) => `${name}:${c}`)
      .join(",") || "none",
    source: "manual",
    note: note || "user-marked",
  });
}

export function clearChatPerfDiagnostics(): void {
  const s = getOrInitState();
  s.events = [];
  s.totalResizeObserversCreated = 0;
  s.totalChannelsCreated = 0;
  s.totalChannelsRemoved = 0;
  s.liveChannels.clear();
  s.liveChatPages.clear();
  s.mounts.clear();
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(PERF_STORAGE_KEY);
  } catch {}
}

export type ChatPerfSnapshot = {
  enabled: boolean;
  installed: boolean;
  liveResizeObservers: number;
  totalResizeObserversCreated: number;
  totalChannelsCreated: number;
  totalChannelsRemoved: number;
  liveChannels: Array<{ topic: string; count: number }>;
  liveChatPages: Array<{ name: string; count: number }>;
  recentEvents: PerfEvent[];
  jsHeapMB?: number;
  jsHeapLimitMB?: number;
};

export function getChatPerfSnapshot(): ChatPerfSnapshot {
  const s = getOrInitState();
  let jsHeapMB: number | undefined;
  let jsHeapLimitMB: number | undefined;
  try {
    const mem = (performance as any).memory;
    if (mem?.usedJSHeapSize) jsHeapMB = Math.round(mem.usedJSHeapSize / 1048576);
    if (mem?.jsHeapSizeLimit) jsHeapLimitMB = Math.round(mem.jsHeapSizeLimit / 1048576);
  } catch {}
  return {
    enabled: s.enabled,
    installed: s.installed,
    liveResizeObservers: s.liveResizeObservers,
    totalResizeObserversCreated: s.totalResizeObserversCreated,
    totalChannelsCreated: s.totalChannelsCreated,
    totalChannelsRemoved: s.totalChannelsRemoved,
    liveChannels: Array.from(s.liveChannels.entries()).map(([topic, count]) => ({ topic, count })),
    liveChatPages: Array.from(s.liveChatPages.entries()).map(([name, count]) => ({ name, count })),
    recentEvents: s.events.slice(-100),
    jsHeapMB,
    jsHeapLimitMB,
  };
}
