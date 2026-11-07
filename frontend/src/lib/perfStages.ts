// Startup timing marks for the ICP sign-in → home journey. Stage names only —
// never principals, names, club/team ids or any other member data.
// Read in DevTools with `window.__igniteStages` or performance.getEntriesByType("mark").
export const PERF_STAGES = [
  "sign_in_click",
  "identity_complete",
  "account_ready",
  "profile_resolved",
  "home_first_paint",
  "first_team_card",
  "carousel_loaded",
] as const;
export type PerfStage = (typeof PERF_STAGES)[number];

type StageMap = Partial<Record<PerfStage, number>>;
const stages: StageMap = {};
let reported = false;
let finished = false;
type Outcome = "success" | "failed" | "timed_out";
let attemptStart = now();
let reportTimer: ReturnType<typeof setTimeout> | undefined;
const sent = new Set<string>();
const attempts: { outcome: Outcome; stages: StageMap }[] = [];
const PENDING = "ignite_startup_attempt";
// Absolute clock survives the II redirect reload; contains timings only.
try {
  const saved = JSON.parse(sessionStorage.getItem(PENDING) ?? "null");
  const clock = performance.timeOrigin + performance.now();
  if (saved && typeof saved.started === "number" && clock - saved.started >= 0 && clock - saved.started < 600_000) {
    attemptStart = saved.started - performance.timeOrigin;
    for (const key of PERF_STAGES) if (typeof saved.stages?.[key] === "number") stages[key] = saved.stages[key] - performance.timeOrigin;
  }
} catch { /* unavailable */ }

function queueReport(): void {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = undefined;
    void reportStartupStages({ ...stages });
  }, 250);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Records the first occurrence of a stage in this page load (ms since navigation start). */
export function markStage(stage: PerfStage): void {
  if (stages[stage] !== undefined) return;
  stages[stage] = Math.round(now());
  try { performance.mark(`ignite:${stage}`); } catch { /* unsupported */ }
  if (typeof window !== "undefined") (window as unknown as { __igniteStages?: StageMap }).__igniteStages = { ...stages };
  if (stages.sign_in_click !== undefined && !finished) {
    try {
      sessionStorage.setItem(PENDING, JSON.stringify({ started: performance.timeOrigin + attemptStart,
        stages: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, performance.timeOrigin + value])) }));
    } catch { /* unavailable */ }
  }
  queueReport();
  if (stage === "home_first_paint") finishStartupAttempt("success");
  if (stage === "carousel_loaded" && !reported) {
    reported = true;
    console.info("[perf] startup stages (ms)", { ...stages });
  }
}

/** A fresh sign-in tap restarts the sign-in stages so repeat attempts are measured on their own. */
export function restartSignInStages(): void {
  resetStagesForTests();
  attemptStart = now();
  try { sessionStorage.removeItem(PENDING); } catch { /* unavailable */ }
}

export function finishStartupAttempt(outcome: Outcome): void {
  if (finished) return;
  finished = true;
  attempts.push({ outcome, stages: { ...stages } });
  if (attempts.length > 30) attempts.shift();
  if (typeof window !== "undefined") (window as unknown as { __igniteStartupAttempts?: typeof attempts }).__igniteStartupAttempts = [...attempts];
  try { sessionStorage.removeItem(PENDING); } catch { /* unavailable */ }
  queueReport();
  void reportStartupStages({ ...stages }, outcome);
}

export const STARTUP_INTERVALS = [
  ["sign_in_click", "identity_complete"],
  ["identity_complete", "account_ready"],
  ["account_ready", "profile_resolved"],
  ["profile_resolved", "home_first_paint"],
  ["home_first_paint", "first_team_card"],
  ["first_team_card", "carousel_loaded"],
  ["identity_complete", "home_first_paint"],
  ["identity_complete", "first_team_card"],
] as const;

/** Durations-only startup samples (surface startup:<stage>) so admins can read them without a console. */
export function startupSamples(s: StageMap, platform: string) {
  const out: { surface: string; source: string; duration_ms: number; cache_hit: boolean; platform: string }[] = [];
  const cold = s.sign_in_click !== undefined;
  for (const k of PERF_STAGES) {
    const v = s[k];
    if (typeof v === "number" && v >= 0 && v < 600_000) out.push({ surface: `startup:${k}`, source: cold ? "sign_in" : "reload", duration_ms: v, cache_hit: !cold, platform });
  }
  for (const [start, end] of STARTUP_INTERVALS) {
    const a = s[start], b = s[end];
    if (a === undefined || b === undefined || b < a || b - a >= 600_000) continue;
    out.push({ surface: `startup_delta:${start}:${end}`, source: cold ? "sign_in" : "reload", duration_ms: b - a, cache_hit: !cold, platform });
  }
  return out;
}

async function reportStartupStages(s: StageMap, outcome?: Outcome): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    const samples = startupSamples(s, platform).filter(sample => !sent.has(sample.surface));
    if (outcome) samples.push({ surface: `startup_outcome:${outcome}`, source: s.sign_in_click === undefined ? "reload" : "sign_in",
      duration_ms: Math.max(0, Math.round(now() - attemptStart)), cache_hit: false, platform });
    if (!samples.length) return;
    const { withFeatureBackend } = await import("@/live/featureRouter");
    await withFeatureBackend("analytics", {
      supabase: async () => {},
      icp: async (ctx) => {
        const { recordLivePerfSamplesBatch } = await import("@/live/features/insights");
        // Reserve before awaiting so overlapping milestones never double count.
        samples.forEach(sample => sent.add(sample.surface));
        try { await recordLivePerfSamplesBatch(ctx, samples); }
        catch (error) { samples.forEach(sample => sent.delete(sample.surface)); throw error; }
      },
    }, { shared: "app" });
  } catch { /* best effort */ }
}

export function getStages(): StageMap {
  return { ...stages };
}

export function resetStagesForTests(): void {
  for (const k of Object.keys(stages) as PerfStage[]) delete stages[k];
  reported = false;
  finished = false;
  sent.clear();
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = undefined;
}
