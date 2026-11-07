/**
 * Per-open chat timing trace: tap → first visible message, split into
 * JavaScript loading, authentication (identity/agent ready), canister read
 * (with which path served it) and enrichment (reactions/pins).
 *
 * Pure module (no ICP imports) so App.tsx can install the tap listener at
 * boot. Stores conversation ids only in memory; samples leave the device as
 * stage names and durations, never ids or message content.
 */

export type ChatReadPath = "query" | "update" | "query_refused_update" | "warm" | "cache";

interface Trace {
  consumed?: boolean;
  queryStart?: number;
  queryDone?: number;
  fallbackStart?: number;
  fallbackDone?: number;
  fallbackReason?: ChatFallbackReason;
  callStart?: number;
  connectDone?: number;
  callDone?: number;
  refusedAt?: number;
  path?: ChatReadPath;
  enrichmentDone?: number;
}

const TAP_WINDOW_MS = 4_000;
let lastTapAt: number | null = null;
let installed = false;
const traces = new Map<string, Trace>();
export type ChatFallbackReason = "stale_sequence" | "missing_sequence" | "method_missing" | "access_denied" | "authority_unavailable" | "protected_mode" | "query_error" | "write_fence" | "query_unsupported";
export type ChatStageEvent = { stage: "query_attempt" | "query_failure" | "update_fallback" | "canister_response" | "enrichment_complete"; duration_ms: number; reason?: ChatFallbackReason };
const stageListeners = new Set<(event: ChatStageEvent) => void>();
export function onChatStage(listener: (event: ChatStageEvent) => void): () => void {
  stageListeners.add(listener); return () => { stageListeners.delete(listener); };
}
function emit(event: ChatStageEvent): void {
  for (const listener of stageListeners) { try { listener(event); } catch { /* telemetry is optional */ } }
}
export function queryFallbackReason(error: unknown): ChatFallbackReason {
  const text = error instanceof Error ? error.message : String(error);
  if (/has no .*method|IC0536|is not a function/i.test(text)) return "method_missing";
  if (/protected|legacy.*query|consensus account/i.test(text)) return "protected_mode";
  if (/authority unavailable/i.test(text)) return "authority_unavailable";
  if (/forbidden|denied|fenced|authorization changed/i.test(text)) return "access_denied";
  return "query_error";
}
export function traceQueryStart(id: string): void { trace(id).queryStart = Date.now(); }
export function traceQueryDone(id: string, reason?: ChatFallbackReason): void {
  const t = trace(id); t.queryDone = Date.now(); t.fallbackReason = reason;
  const duration_ms = Math.max(0, t.queryDone - (t.queryStart ?? t.queryDone));
  emit({ stage: "query_attempt", duration_ms, reason });
  if (reason) emit({ stage: "query_failure", duration_ms, reason });
}
export function traceFallbackStart(id: string, reason: ChatFallbackReason): void {
  const t = trace(id); t.fallbackStart = Date.now(); t.fallbackReason = reason;
}
export function traceFallbackDone(id: string): void {
  const t = trace(id); t.fallbackDone = Date.now();
  emit({ stage: "update_fallback", duration_ms: Math.max(0, t.fallbackDone - (t.fallbackStart ?? t.fallbackDone)), reason: t.fallbackReason });
}

/** Records the most recent tap anywhere, so a chat page mounting shortly
 *  after can anchor its timing to the tap rather than to its own mount. */
export function installChatTapListener(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  try {
    document.addEventListener("pointerup", () => { lastTapAt = Date.now(); }, { capture: true, passive: true });
  } catch { /* ignore */ }
}

/** Test hook. */
export function __resetChatOpenTrace(): void {
  lastTapAt = null;
  traces.clear();
}
export function __setLastTap(ts: number | null): void { lastTapAt = ts; }

function trace(conversationId: string): Trace {
  let t = traces.get(conversationId);
  if (!t) { t = {}; traces.set(conversationId, t); }
  if (traces.size > 200) {
    const oldest = traces.keys().next().value;
    if (oldest !== undefined) traces.delete(oldest);
  }
  return t;
}

/** First-page read began (before connecting to the service). */
export function traceReadStart(conversationId: string): void {
  // A new open replaces any stale, never-consumed trace for this chat.
  traces.set(conversationId, { callStart: Date.now() });
}
export function traceConnected(conversationId: string): void {
  const t = trace(conversationId);
  if (t.connectDone === undefined) t.connectDone = Date.now();
}
/** The quick read was refused (protected mode, membership authority
 *  unreachable, older service) — the consensus read follows. */
export function traceQueryRefused(conversationId: string): void {
  const t = trace(conversationId);
  if (t.refusedAt === undefined) t.refusedAt = Date.now();
}
export function traceReadDone(conversationId: string, path: ChatReadPath): void {
  const t = trace(conversationId);
  if (t.callDone !== undefined) return;
  t.callDone = Date.now();
  t.path = path;
  emit({ stage: "canister_response", duration_ms: Math.max(0, t.callDone - (t.connectDone ?? t.callStart ?? t.callDone)) });
}
export function traceEnrichmentDone(conversationId: string): void {
  const t = traces.get(conversationId);
  if (t && t.enrichmentDone === undefined) {
    t.enrichmentDone = Date.now();
    emit({ stage: "enrichment_complete", duration_ms: Math.max(0, t.enrichmentDone - (t.callDone ?? t.callStart ?? t.enrichmentDone)) });
    if (t.consumed) traces.delete(conversationId);
  }
}

export type ChatOpenClass = "notification" | "cold_open" | "cached_open";

/**
 * Honest open classification. `cold_open` = nothing on screen from the local
 * cache; repeated opens without a usable cache are still genuinely cold.
 */
export function classifyChatOpen(conversationId: string, notification: boolean, fromCache: boolean): ChatOpenClass {
  if (notification) return "notification";
  return fromCache ? "cached_open" : "cold_open";
}

export interface ChatOpenBreakdown {
  query_attempt_ms?: number;
  update_fallback_ms?: number;
  fallback_reason?: ChatFallbackReason;
  /** Tap (or mount when no recent tap) → first visible message. */
  total_ms: number;
  /** Tap → chat page mounted (route + lazy JavaScript chunk). */
  js_load_ms?: number;
  /** Mount → read start (waiting for sign-in/session to be ready). */
  auth_wait_ms?: number;
  /** Read start → service actor ready (identity/agent handshake). */
  connect_ms?: number;
  /** Time spent on a refused quick read before the consensus fallback. */
  authz_fallback_ms?: number;
  /** Service call (includes on-canister authorisation checks). */
  canister_ms?: number;
  /** Read return → first message painted (decode, names, render). */
  render_ms?: number;
  /** Read start → reactions/pins ready (may land after first message). */
  enrichment_ms?: number;
  read_path?: ChatReadPath;
  anchored_to_tap: boolean;
}

/** Consumes the trace for this chat and returns the stage split. */
export function takeChatOpenBreakdown(conversationId: string, mountTs: number, renderTs = Date.now()): ChatOpenBreakdown {
  const t = traces.get(conversationId);
  if (t) t.consumed = true;
  const tapAnchored = lastTapAt !== null && lastTapAt <= mountTs && mountTs - lastTapAt <= TAP_WINDOW_MS;
  const anchor = tapAnchored ? (lastTapAt as number) : mountTs;
  const d = (a?: number, b?: number) => (a !== undefined && b !== undefined ? Math.max(0, b - a) : undefined);
  const out: ChatOpenBreakdown = { total_ms: Math.max(0, renderTs - anchor), anchored_to_tap: tapAnchored };
  if (tapAnchored) out.js_load_ms = mountTs - anchor;
  if (!t || t.callStart === undefined || t.callStart > renderTs) {
    // Painted from local cache before any read started.
    out.read_path = "cache";
    return out;
  }
  out.auth_wait_ms = d(mountTs, t.callStart);
  out.connect_ms = d(t.callStart, t.connectDone);
  out.query_attempt_ms = d(t.queryStart, t.queryDone);
  out.update_fallback_ms = d(t.fallbackStart, t.fallbackDone);
  out.fallback_reason = t.fallbackReason;
  const callFrom = t.refusedAt ?? t.connectDone ?? t.callStart;
  if (t.refusedAt !== undefined) out.authz_fallback_ms = d(t.connectDone ?? t.callStart, t.refusedAt);
  out.canister_ms = d(callFrom, t.callDone);
  out.render_ms = d(t.callDone, renderTs);
  out.enrichment_ms = d(t.callStart, t.enrichmentDone);
  out.read_path = t.path;
  return out;
}
