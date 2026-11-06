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
const openedThisSession = new Set<string>();

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
  openedThisSession.clear();
}
export function __setLastTap(ts: number | null): void { lastTapAt = ts; }

function trace(conversationId: string): Trace {
  let t = traces.get(conversationId);
  if (!t) { t = {}; traces.set(conversationId, t); }
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
}
export function traceEnrichmentDone(conversationId: string): void {
  const t = traces.get(conversationId);
  if (t && t.enrichmentDone === undefined) t.enrichmentDone = Date.now();
}

export type ChatOpenClass = "notification" | "cold_open" | "cached_open";

/**
 * Honest open classification. `cold_open` = nothing on screen from the local
 * cache AND the first open of this chat in this app session; anything that
 * painted from cache (or was opened earlier this session) is `cached_open`.
 */
export function classifyChatOpen(conversationId: string, notification: boolean, fromCache: boolean): ChatOpenClass {
  const seen = openedThisSession.has(conversationId);
  openedThisSession.add(conversationId);
  if (notification) return "notification";
  return !fromCache && !seen ? "cold_open" : "cached_open";
}

export interface ChatOpenBreakdown {
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
  traces.delete(conversationId);
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
  const callFrom = t.refusedAt ?? t.connectDone ?? t.callStart;
  if (t.refusedAt !== undefined) out.authz_fallback_ms = d(t.connectDone ?? t.callStart, t.refusedAt);
  out.canister_ms = d(callFrom, t.callDone);
  out.render_ms = d(t.callDone, renderTs);
  out.enrichment_ms = d(t.callStart, t.enrichmentDone);
  out.read_path = t.path;
  return out;
}
