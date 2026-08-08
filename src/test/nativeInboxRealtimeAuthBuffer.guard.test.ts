import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const src = readFileSync("src/pages/MessagesPage.tsx", "utf8");

// Isolate the native lightweight realtime effect.
const nativeBlock = src.slice(src.indexOf("Native-only: lightweight realtime"));

describe("native inbox realtime authorization-hydration buffer", () => {
  it("buffers native events while authorized scopes are not ready", () => {
    expect(src).toContain("pendingNativeRealtimeRef");
    expect(nativeBlock).toContain("if (authStatusRef.current !== 'ready') {");
    expect(nativeBlock).toContain("buf.push({ table, payload, kind }");
  });

  it("bounds the buffer to 50 events, dropping the oldest first", () => {
    expect(nativeBlock).toContain("MAX_PENDING_NATIVE = 50");
    expect(nativeBlock).toContain(
      "buf.splice(0, buf.length - MAX_PENDING_NATIVE)",
    );
  });

  it("replays only after status becomes ready and discards on failure", () => {
    expect(src).toContain('if (authScopes.status === "ready") {');
    expect(src).toContain("nativeRealtimeFlushRef.current?.()");
    expect(src).toContain('if (authScopes.status === "failed") {');
    expect(src).toContain("nativeRealtimeDiscardRef.current?.()");
  });

  it("re-runs the fail-closed authorization check on replay", () => {
    // Replay goes through the same handlers map, which starts every branch
    // with isAuthorized(...)/status checks.
    expect(nativeBlock).toContain("for (const item of buffered) applyOnce(item.table, item.payload,");
    expect(nativeBlock).toContain("handlers[table]?.(payload)");
    for (const kind of ["'team'", "'club'", "'group'", "'dm'"]) {
      expect(nativeBlock).toContain(`isAuthorized(${kind}`);
    }
    expect(nativeBlock).toContain("if (authStatusRef.current !== 'ready') return;");
  });

  it("deduplicates replayed events by immutable event identity", () => {
    expect(nativeBlock).toContain("appliedEventKeys");
    expect(nativeBlock).toContain("if (appliedEventKeys.has(key)) return;");
  });

  it("clears the buffer on cleanup / user change / sign-out", () => {
    expect(nativeBlock).toContain("pendingNativeRealtimeRef.current = []");
    expect(nativeBlock).toContain("nativeRealtimeFlushRef.current = null");
  });

  it("keeps native behaviour invalidation-free on the realtime hot path", () => {
    expect(nativeBlock).not.toContain("invalidateQueries");
    expect(nativeBlock).toContain("setQueryData");
  });

  it("preserves the separate web buffer and channel", () => {
    expect(src).toContain("pendingRealtimeRef");
    expect(src).toContain("messages-inbox-${user.id}");
  });
});
