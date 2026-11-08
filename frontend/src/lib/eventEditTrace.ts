/**
 * Timing for the edit-event flow, reported as durations-only perf samples
 * (surface `event_edit:<stage>`) so admins can read them on the Speed card.
 *
 *  form_open       page mount → form populated and editable
 *  details_load    event details request start → answer
 *  save_start      Save tap → first backend write sent (validation, sign-in check)
 *  main_update     main event write sent → confirmed
 *  related_updates main write confirmed → duty / duty-team / reminder / series writes done
 *
 * No titles, ids or names are reported.
 */
export const EVENT_EDIT_STAGES = ["form_open", "details_load", "save_start", "main_update", "related_updates"] as const;
export type EventEditStage = (typeof EVENT_EDIT_STAGES)[number];
export type EventEditKind = "ordinary" | "recurring_series" | "recurring_occurrence" | "recurring_conversion" | "game";

export type EventEditSample = { surface: string; source: string; duration_ms: number; cache_hit: boolean; platform: string };

const MAX_MS = 600_000;

export function eventEditSample(stage: EventEditStage, kind: EventEditKind, durationMs: number, platform: string, cached = false): EventEditSample | null {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_MS) return null;
  return { surface: `event_edit:${stage}`, source: kind, duration_ms: Math.round(durationMs), cache_hit: cached, platform };
}

const pending: EventEditSample[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export function recordEventEditStage(stage: EventEditStage, kind: EventEditKind, durationMs: number, cached = false): void {
  let platform = "web";
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
    if (cap?.isNativePlatform?.()) platform = cap.getPlatform?.() ?? "native";
  } catch { /* ignore */ }
  const sample = eventEditSample(stage, kind, durationMs, platform, cached);
  if (!sample) return;
  if (typeof console !== "undefined") console.info(`[perf] event edit ${stage} (${kind}): ${sample.duration_ms}ms`);
  pending.push(sample);
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = undefined; void flush(); }, 1500);
}

async function flush(): Promise<void> {
  const batch = pending.splice(0, pending.length);
  if (!batch.length) return;
  try {
    const { withFeatureBackend } = await import("@/live/featureRouter");
    await withFeatureBackend("analytics", {
      supabase: async () => {},
      icp: async (ctx) => {
        const { recordLivePerfSamplesBatch } = await import("@/live/features/insights");
        await recordLivePerfSamplesBatch(ctx, batch);
      },
    }, { shared: "app" });
  } catch { /* best effort */ }
}

export function takePendingEventEditSamplesForTests(): EventEditSample[] {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }
  return pending.splice(0, pending.length);
}
