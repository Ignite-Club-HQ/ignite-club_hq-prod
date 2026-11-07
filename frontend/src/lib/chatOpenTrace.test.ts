import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetChatOpenTrace, __setLastTap, classifyChatOpen, takeChatOpenBreakdown,
  traceConnected, traceReadDone, traceReadStart,
  traceQueryStart, traceQueryDone, traceFallbackStart, traceFallbackDone, traceEnrichmentDone, onChatStage,
} from "./chatOpenTrace";

beforeEach(() => __resetChatOpenTrace());

describe("chat open classification", () => {
  it("labels an open that painted from cache as cached, not cold", () => {
    expect(classifyChatOpen("c1", false, true)).toBe("cached_open");
  });
  it("keeps repeated uncached opens genuinely cold", () => {
    expect(classifyChatOpen("c1", false, false)).toBe("cold_open");
    expect(classifyChatOpen("c1", false, false)).toBe("cold_open");
  });
  it("keeps notification opens separate", () => {
    expect(classifyChatOpen("c1", true, true)).toBe("notification");
  });
});

describe("chat open breakdown", () => {
  it("records failed query and fallback durations even when opening fails", () => {
    const events: any[] = []; const stop = onChatStage(e => events.push(e));
    traceReadStart("c"); traceConnected("c"); traceQueryStart("c");
    traceQueryDone("c", "stale_sequence"); traceFallbackStart("c", "stale_sequence"); traceFallbackDone("c");
    expect(events.map(e => e.stage)).toEqual(["query_attempt", "query_failure", "update_fallback"]);
    expect(events.every(e => e.reason === "stale_sequence" && e.duration_ms >= 0)).toBe(true); stop();
  });
  it("records enrichment completing after the first paint consumed the breakdown", () => {
    const events: any[] = []; const stop = onChatStage(e => events.push(e));
    traceReadStart("c"); traceReadDone("c", "query"); takeChatOpenBreakdown("c", Date.now()); traceEnrichmentDone("c");
    expect(events.map(e => e.stage)).toContain("enrichment_complete"); stop();
  });
  it("anchors to a tap within 4 seconds before mount", () => {
    const mount = Date.now();
    __setLastTap(mount - 300);
    const b = takeChatOpenBreakdown("c1", mount, mount + 200);
    expect(b.anchored_to_tap).toBe(true);
    expect(b.js_load_ms).toBe(300);
    expect(b.total_ms).toBe(500);
    expect(b.read_path).toBe("cache");
  });
  it("ignores a tap older than 4 seconds", () => {
    const mount = Date.now();
    __setLastTap(mount - 5_000);
    expect(takeChatOpenBreakdown("c1", mount, mount + 10).anchored_to_tap).toBe(false);
  });
  it("splits the read into connect and canister time", () => {
    const mount = Date.now() - 1_000;
    traceReadStart("c1");
    traceConnected("c1");
    traceReadDone("c1", "query");
    const b = takeChatOpenBreakdown("c1", mount);
    expect(b.read_path).toBe("query");
    expect(typeof b.canister_ms).toBe("number");
    expect(b.auth_wait_ms).toBeGreaterThanOrEqual(1_000);
  });
});
