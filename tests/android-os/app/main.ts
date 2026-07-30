/**
 * Android OS resume regression harness — synthetic WebView app.
 *
 * Runs INSIDE a genuine Android emulator, driven by real OS lifecycle events
 * (home/recents/lock/unlock, radio on/off). It mounts 30 active React Query
 * observers and wires up the REAL production resume/reconnect adapter
 * (`src/lib/reactQueryNativeAdapter.ts`) so the regression that shipped in
 * 0ee10f109 — a blanket `refetchQueries({ type: 'active' })` on every resume —
 * cannot come back unnoticed.
 *
 * SAFETY: this app never talks to Supabase. Query functions are local
 * promises, `VITE_SUPABASE_URL` is compiled out as `undefined`, and
 * `@/lib/supabaseAuthRetry` is aliased to a local stub (see
 * `tests/android-os/vite.config.ts`). See `verify-safety.mjs`.
 *
 * All observations are emitted to logcat via `console.log` with the
 * `AOSTEST` prefix; `run-emulator-test.sh` asserts on those lines.
 */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { setupReactQueryNativeAdapter } from "@/lib/reactQueryNativeAdapter";

const OBSERVER_COUNT = 30;
const WINDOW_MS = 3500;
/** Fetch starts more than this far apart belong to different batches. */
const BATCH_GAP_MS = 60;

const log = (line: string) => {
  // eslint-disable-next-line no-console
  console.log(`AOSTEST ${line}`);
};

// ---------------------------------------------------------------------------
// Fetch accounting
// ---------------------------------------------------------------------------
let totalFetches = 0;
let fetchesSinceEvent = 0;
let inFlight = 0;
let maxConcurrent = 0;
let windowStartTotal = 0;
let windowStarts: number[] = [];

function recordStart() {
  totalFetches += 1;
  fetchesSinceEvent += 1;
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
// Query client + 30 synthetic active observers
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

const observers: Array<QueryObserver<number>> = [];
const unsubscribes: Array<() => void> = [];

for (let i = 0; i < OBSERVER_COUNT; i += 1) {
  const observer = new QueryObserver<number>(queryClient, {
    queryKey: ["synthetic", i],
    queryFn: async () => {
      recordStart();
      // Local, network-free work with a realistic latency profile.
      await new Promise((r) => setTimeout(r, 60));
      recordEnd();
      return totalFetches;
    },
  });
  unsubscribes.push(observer.subscribe(() => {}));
  observers.push(observer);
}

// ---------------------------------------------------------------------------
// Liveness: rAF frames + taps prove the WebView still composites and routes
// input after resume (compositor freeze / ANR detection).
// ---------------------------------------------------------------------------
let frames = 0;
let taps = 0;
const spinner = document.getElementById("spinner")!;
const tapTarget = document.getElementById("tap")!;
const stateEl = document.getElementById("state")!;

const tick = () => {
  frames += 1;
  spinner.style.transform = `rotate(${(frames * 6) % 360}deg)`;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

tapTarget.addEventListener("pointerdown", () => {
  taps += 1;
  tapTarget.textContent = `TAPPED ${taps}`;
});

setInterval(() => {
  stateEl.textContent =
    `observers=${OBSERVER_COUNT} fetches=${totalFetches} ` +
    `frames=${frames} taps=${taps}`;
  log(`ALIVE frames=${frames} taps=${taps} total=${totalFetches}`);
}, 2000);

// ---------------------------------------------------------------------------
// Lifecycle instrumentation. Every OS event opens a measurement window; the
// window line is what the shell asserts on.
// ---------------------------------------------------------------------------
let seq = 0;

function openWindow(type: string, extra = "") {
  seq += 1;
  const mySeq = seq;
  log(
    `EVENT seq=${mySeq} type=${type} ${extra} ` +
      `fetchesSinceLastEvent=${fetchesSinceEvent} total=${totalFetches}`,
  );
  fetchesSinceEvent = 0;
  windowStartTotal = totalFetches;
  windowStarts = [];
  maxConcurrent = 0;
  setTimeout(() => {
    const fetches = totalFetches - windowStartTotal;
    log(
      `WINDOW seq=${mySeq} after=${type} fetches=${fetches} ` +
        `batches=${countBatches(windowStarts)} maxConcurrent=${maxConcurrent}`,
    );
  }, WINDOW_MS);
}

let hiddenAt = 0;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    log(`HIDDEN at=${hiddenAt}`);
    return;
  }
  const hiddenMs = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  openWindow("resume", `hiddenMs=${hiddenMs}`);
});

void (async () => {
  const { App } = await import("@capacitor/app");
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) return; // resume is covered by visibilitychange
    log("PAUSE native");
  });

  const { Network } = await import("@capacitor/network");
  let wasConnected = (await Network.getStatus()).connected;
  await Network.addListener("networkStatusChange", (status) => {
    if (status.connected === wasConnected) return;
    wasConnected = status.connected;
    openWindow(status.connected ? "online" : "offline");
  });

  // Wire up the REAL production adapter under test.
  setupReactQueryNativeAdapter(queryClient);

  // Prime: let the initial 30 fetches settle before the emulator script
  // starts driving OS events.
  setTimeout(() => {
    log(`READY observers=${OBSERVER_COUNT} initialFetches=${totalFetches}`);
    fetchesSinceEvent = 0;
  }, 4000);
})();

// Expose for adb-driven introspection / debugging.
(window as unknown as Record<string, unknown>).__aosTest = {
  get totalFetches() {
    return totalFetches;
  },
  get frames() {
    return frames;
  },
  get taps() {
    return taps;
  },
  observers,
  unsubscribes,
};
