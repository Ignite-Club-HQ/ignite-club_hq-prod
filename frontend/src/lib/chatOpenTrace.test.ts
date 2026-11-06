import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetChatOpenTrace, __setLastTap, classifyChatOpen, takeChatOpenBreakdown,
  traceConnected, traceReadDone, traceReadStart,
} from "./chatOpenTrace";

beforeEach(() => __resetChatOpenTrace());

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
