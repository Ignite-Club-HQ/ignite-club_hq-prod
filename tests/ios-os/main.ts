/**
 * iOS OS resume regression harness — synthetic WKWebView app.
 *
 * Runs INSIDE a genuine iOS Simulator, driven by real OS lifecycle
 * transitions (background / reactivate, overlapping wake signals, long
 * background intervals, interrupted wakes). It mounts 30 active React Query
 * observers and wires up the REAL production modules under test:
 *
 *   - `src/lib/reactQueryNativeAdapter.ts`  (resume / reconnect recovery)
 *   - `src/lib/androidWebViewWake.ts`       (cross-platform `setupWebViewWake`)
 *
 * The regression it protects against: a blanket
 * `refetchQueries({ type: 'active' })` on every resume, which saturated the
 * WebView connection pool and froze Inbox / Schedule / Media.
 *
 * SAFETY: this app never talks to Supabase. Query functions are local
 * promises, `VITE_SUPABASE_URL` is compiled out as `undefined`, and
 * `@/lib/supabaseAuthRetry` is aliased to a local stub (see
 * `tests/ios-os/vite.config.ts`). See `verify-safety.mjs`.
 *
 * Machine-readable state is rendered into `#state` (readable from the
 * WKWebView accessibility tree AND the DOM) and mirrored to the console with
 * the stable `[IOS_OS_TEST_STATE]` prefix.
 */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { setupReactQueryNativeAdapter } from "@/lib/reactQueryNativeAdapter";
import { setupWebViewWake } from "@/lib/androidWebViewWake";

/** 18 Inbox + 6 Schedule + 6 Media = 30 active observers. */
const GROUPS = [
  { name: "inbox", count: 18 },
  { name: "schedule", count: 6 },
  { name: "media", count: 6 },
] as const;
const OBSERVER_COUNT = GROUPS.reduce((n, g) => n + g.count, 0);

/** Fetch starts more than this far apart belong to different batches. */
const BATCH_GAP_MS = 60;
/** Fetches inside this window after a lifecycle event are attributed to it. */
const WINDOW_MS = 3500;

// ---------------------------------------------------------------------------
// Counters (the observable contract for the automation)
// ---------------------------------------------------------------------------
let refetchCount = 0; // fetches after READY — the blanket-refetch detector
let totalFetches = 0;
let resumeCount = 0;
let backgroundCount = 0;
let pingCount = 0;
let frames = 0;
let ready = false;
let online = true;

let inFlight = 0;
let maxConcurrent = 0;
let windowStarts: number[] = [];
let windowStartRefetches = 0;

const log = (line: string) => {
  // eslint-disable-next-line no-console
  console.log(`[IOS_OS_TEST_STATE] ${line}`);
};

function recordStart() {
  totalFetches += 1;
  if (ready) refetchCount += 1;
  inFlight += 1;
  if (inFlight > maxConcurrent) maxConcurrent = inFlight;
  windowStarts.push(Date.now());
}

function recordEnd() {
  inFlight = Math.max(0, inFlight - 1);
}

function countBatches(starts: number[]): number {
  if (starts.length === 0) return 0;
  const sorted = [...starts].sort((a, b) => a - b);
  let batches = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > BATCH_GAP_MS) batches += 1;
  }
  return batches;
}

// ---------------------------------------------------------------------------
// Query client + 30 synthetic active observers (no network, ever)
// ---------------------------------------------------------------------------
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  },
});

/** Request-saturation support: gate synthetic fetches until released. */
let saturationGate: Promise<void> | null = null;
let releaseSaturation: (() => void) | null = null;

const observers: Array<QueryObserver<number>> = [];
const unsubscribes: Array<() => void> = [];

for (const group of GROUPS) {
  for (let i = 0; i < group.count; i += 1) {
    const observer = new QueryObserver<number>(queryClient, {
      queryKey: [group.name, i],
      queryFn: async () => {
        recordStart();
        try {
          if (saturationGate) await saturationGate;
          await new Promise((r) => setTimeout(r, 60));
        } finally {
          recordEnd();
        }
        return totalFetches;
      },
    });
    unsubscribes.push(observer.subscribe(() => {}));
    observers.push(observer);
  }
}

// ---------------------------------------------------------------------------
// Liveness + machine-readable state
// ---------------------------------------------------------------------------
const stateEl = document.getElementById("state")!;
const spinner = document.getElementById("spinner")!;
const pingBtn = document.getElementById("ping") as HTMLButtonElement;
const saturateBtn = document.getElementById("saturate") as HTMLButtonElement;

const tick = () => {
  frames += 1;
  spinner.style.transform = `rotate(${(frames * 6) % 360}deg)`;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

function stateLines(): string[] {
  return [
    ready ? "IOS_OS_READY" : "IOS_OS_BOOTING",
    `ACTIVE=${OBSERVER_COUNT}`,
    `REFETCH_COUNT=${refetchCount}`,
    `ONLINE=${online ? "true" : "false"}`,
    `RESUME_COUNT=${resumeCount}`,
    `BACKGROUND_COUNT=${backgroundCount}`,
    `PING_COUNT=${pingCount}`,
    `FRAMES=${frames}`,
    `TOTAL_FETCHES=${totalFetches}`,
  ];
}

function render() {
  const text = stateLines().join("\n");
  stateEl.textContent = text;
  stateEl.setAttribute("aria-label", stateLines().join(" "));
}

setInterval(() => {
  render();
  log(stateLines().join(" "));
}, 1000);

pingBtn.addEventListener("click", () => {
  pingCount += 1;
  pingBtn.textContent = `PING OK ${pingCount}`;
  render();
  log(`PING_OK count=${pingCount}`);
});

saturateBtn.addEventListener("click", () => {
  if (saturationGate) {
    releaseSaturation?.();
    saturationGate = null;
    releaseSaturation = null;
    saturateBtn.textContent = "SATURATE";
    log("SATURATION released");
    return;
  }
  saturationGate = new Promise<void>((resolve) => {
    releaseSaturation = resolve;
  });
  saturateBtn.textContent = "SATURATED (tap to release)";
  log("SATURATION engaged");
  // Force all 30 observers to start a (blocked) fetch.
  void queryClient.refetchQueries({ type: "active" });
});

// ---------------------------------------------------------------------------
// Lifecycle instrumentation
// ---------------------------------------------------------------------------
let seq = 0;
let hiddenAt = 0;

function openWindow(type: string, extra = "") {
  seq += 1;
  const mySeq = seq;
  windowStartRefetches = refetchCount;
  windowStarts = [];
  maxConcurrent = 0;
  log(`EVENT seq=${mySeq} type=${type} ${extra} REFETCH_COUNT=${refetchCount}`);
  setTimeout(() => {
    log(
      `WINDOW seq=${mySeq} after=${type} fetches=${refetchCount - windowStartRefetches} ` +
        `batches=${countBatches(windowStarts)} maxConcurrent=${maxConcurrent} ` +
        `REFETCH_COUNT=${refetchCount}`,
    );
    render();
  }, WINDOW_MS);
}

/** Coalesce overlapping wake signals (appStateChange + visibility + focus + pageshow). */
let lastResumeAt = 0;
function noteResume(source: string) {
  const now = Date.now();
  if (now - lastResumeAt < 1200) {
    log(`RESUME_COALESCED source=${source}`);
    return;
  }
  lastResumeAt = now;
  resumeCount += 1;
  const hiddenMs = hiddenAt ? now - hiddenAt : 0;
  hiddenAt = 0;
  openWindow("resume", `source=${source} hiddenMs=${hiddenMs} RESUME_COUNT=${resumeCount}`);
  render();
}

function noteBackground(source: string) {
  backgroundCount += 1;
  hiddenAt = Date.now();
  log(`BACKGROUND source=${source} BACKGROUND_COUNT=${backgroundCount}`);
  render();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") noteBackground("visibilitychange");
  else noteResume("visibilitychange");
});
window.addEventListener("focus", () => noteResume("focus"));
window.addEventListener("pageshow", () => noteResume("pageshow"));

void (async () => {
  const { App } = await import("@capacitor/app");
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) noteResume("appStateChange");
    else noteBackground("appStateChange");
  });

  const { Network } = await import("@capacitor/network");
  const status = await Network.getStatus();
  online = status.connected;
  let wasConnected = status.connected;
  await Network.addListener("networkStatusChange", (next) => {
    if (next.connected === wasConnected) return;
    wasConnected = next.connected;
    online = next.connected;
    openWindow(next.connected ? "online" : "offline");
    render();
  });

  // Wire up the REAL production modules under test.
  setupReactQueryNativeAdapter(queryClient);
  setupWebViewWake();

  // Prime: let the initial 30 fetches settle, then start counting refetches.
  setTimeout(() => {
    ready = true;
    refetchCount = 0;
    render();
    log(`IOS_OS_READY ACTIVE=${OBSERVER_COUNT} initialFetches=${totalFetches}`);
  }, 4000);
})();

render();

// Expose for driver-side introspection / debugging.
(window as unknown as Record<string, unknown>).__iosOsTest = {
  get refetchCount() {
    return refetchCount;
  },
  get resumeCount() {
    return resumeCount;
  },
  get backgroundCount() {
    return backgroundCount;
  },
  get pingCount() {
    return pingCount;
  },
  get frames() {
    return frames;
  },
  get online() {
    return online;
  },
  stateLines,
  observers,
  unsubscribes,
};
