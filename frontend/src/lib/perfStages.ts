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

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Records the first occurrence of a stage in this page load (ms since navigation start). */
export function markStage(stage: PerfStage): void {
  if (stages[stage] !== undefined) return;
  stages[stage] = Math.round(now());
  try { performance.mark(`ignite:${stage}`); } catch { /* unsupported */ }
  if (typeof window !== "undefined") (window as unknown as { __igniteStages?: StageMap }).__igniteStages = { ...stages };
  if (stage === "carousel_loaded" && !reported) {
    reported = true;
    console.info("[perf] startup stages (ms)", { ...stages });
    void reportStartupStages({ ...stages });
  }
}

/** A fresh sign-in tap restarts the sign-in stages so repeat attempts are measured on their own. */
export function restartSignInStages(): void {
  for (const s of ["sign_in_click", "identity_complete", "account_ready", "profile_resolved"] as const) delete stages[s];
}

/** Durations-only startup samples (surface startup:<stage>) so admins can read them without a console. */
export function startupSamples(s: StageMap, platform: string) {
  const out: { surface: string; source: string; duration_ms: number; cache_hit: boolean; platform: string }[] = [];
  const cold = s.sign_in_click !== undefined;
  for (const k of PERF_STAGES) {
    const v = s[k];
    if (typeof v === "number" && v >= 0 && v < 600_000) out.push({ surface: `startup:${k}`, source: cold ? "sign_in" : "reload", duration_ms: v, cache_hit: !cold, platform });
  }
  return out;
}

async function reportStartupStages(s: StageMap): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    const { withFeatureBackend } = await import("@/live/featureRouter");
    await withFeatureBackend("analytics", {
      supabase: async () => {},
      icp: async (ctx) => {
        const { recordLivePerfSamplesBatch } = await import("@/live/features/insights");
        await recordLivePerfSamplesBatch(ctx, startupSamples(s, platform));
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
}
