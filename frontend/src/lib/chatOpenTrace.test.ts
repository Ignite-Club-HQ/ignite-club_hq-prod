import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetChatOpenTrace, __setLastTap, classifyChatOpen, takeChatOpenBreakdown,
  traceConnected, traceReadDone, traceReadStart, timeChatOperation,
} from "./chatOpenTrace";

beforeEach(() => __resetChatOpenTrace());

describe('request timings', () => {
  it('records concrete operation duration and failure without recording inputs or content', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000); __setLastTap(1000);
    try {
      const result = timeChatOperation('open_conversation_query', 'query', async () => { await new Promise(resolve => setTimeout(resolve, 600)); return 'private message'; });
      await vi.advanceTimersByTimeAsync(600); await result;
      const entries = (window as any).__igniteChatOperations;
      expect(entries).toEqual([{ operation: 'open_conversation_query', mode: 'query', started_ms: 0, duration_ms: 600, outcome: 'ok' }]);
      expect(JSON.stringify(entries)).not.toContain('private message');
    } finally { vi.useRealTimers(); }
  });
});

describe("chat open classification", () => {
  it("labels an open that painted from cache as cached, not cold", () => {
    expect(classifyChatOpen("c1", false, true)).toBe("cached_open");
  });
  it("labels a second open of the same chat this session as cached", () => {
    expect(classifyChatOpen("c1", false, false)).toBe("cold_open");
    expect(classifyChatOpen("c1", false, false)).toBe("cached_open");
  });
  it("keeps notification opens separate", () => {
    expect(classifyChatOpen("c1", true, true)).toBe("notification");
  });
});

describe("chat open breakdown", () => {
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
