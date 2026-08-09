import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

import {
  beginLaunchIntentResolution,
  getLaunchIntentState,
  isLaunchIntentPending,
  markLaunchUrlReceived,
  __resetLaunchIntentForTests,
} from "@/lib/nativeLaunchIntent";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("native launch-intent readiness boundary", () => {
  beforeEach(() => {
    __resetLaunchIntentForTests();
  });

  it("starts pending on native so routing cannot redirect to /auth", () => {
    expect(isLaunchIntentPending()).toBe(true);
  });

  it("queues the invite destination before releasing the boundary", async () => {
    const order: string[] = [];
    beginLaunchIntentResolution(
      async () => ({ url: "https://igniteclubhq.app/join/p/tok123" }),
      (url) => {
        order.push(`nav:${url}`);
        expect(isLaunchIntentPending()).toBe(true);
      },
    );
    await flush();
    expect(order).toEqual(["nav:https://igniteclubhq.app/join/p/tok123"]);
    expect(getLaunchIntentState()).toBe("resolved-url");
    expect(isLaunchIntentPending()).toBe(false);
  });

  it("recovers from a transient getLaunchUrl rejection without a second tap", async () => {
    let calls = 0;
    const seen: string[] = [];
    beginLaunchIntentResolution(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { url: "https://igniteclubhq.app/join/p/tok999" };
      },
      (url) => seen.push(url),
    );
    await flush();
    expect(getLaunchIntentState()).toBe("failed-retrying");
    expect(isLaunchIntentPending()).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(["https://igniteclubhq.app/join/p/tok999"]);
    expect(isLaunchIntentPending()).toBe(false);
  });

  it("releases for an ordinary launch with no URL", async () => {
    beginLaunchIntentResolution(async () => ({ url: null }), () => {
      throw new Error("should not navigate");
    });
    await flush();
    expect(getLaunchIntentState()).toBe("resolved-none");
  });

  it("an appUrlOpen event settles the boundary immediately while pending", () => {
    expect(isLaunchIntentPending()).toBe(true);
    markLaunchUrlReceived();
    expect(getLaunchIntentState()).toBe("resolved-url");
  });
});
