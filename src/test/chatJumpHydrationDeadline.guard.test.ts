import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const list = readFileSync("src/components/chat/VirtualizedChatMessageList.tsx", "utf8");
const jump = readFileSync("src/lib/jumpToMessage.ts", "utf8");

describe("chat jump hydration reveal deadline", () => {
  it("anchors the deep-link reveal deadline once per hydration lifecycle", () => {
    expect(list).toContain("const lifecycleStartedAt = performance.now()");
    expect(list).toContain("const HARD_REVEAL_DEADLINE_MS = 7000");
    expect(list).toContain("hardTimer = window.setTimeout(finish, HARD_REVEAL_DEADLINE_MS)");
  });

  it("bounds retry settle waits by the remaining budget instead of re-arming a fresh one", () => {
    expect(list).toContain("Math.min(6500, remainingBudget())");
    expect(list).toContain("isChatJumpActive() && remainingBudget() > 120");
  });

  it("tracks and clears every retry/hard timer on unmount or target change", () => {
    expect(list).toContain("if (retryTimer !== null) window.clearTimeout(retryTimer)");
    expect(list).toContain("if (hardTimer !== null) window.clearTimeout(hardTimer)");
    expect(list).toContain("initialBottomPinned, initialTargetMessageId]");
  });

  it("gives the jump overlay its own non-restartable lifecycle budget", () => {
    expect(list).toContain("const OVERLAY_HARD_DEADLINE_MS = 7000");
    expect(list).toContain("lifecycleStartedAt = performance.now()");
    expect(list).toContain("maxMs: Math.min(8000, budget)");
    expect(list).toContain("if (isChatJumpActive()) onStart();");
  });

  it("releases the overlay from jumpToMessage even when polling never lands", () => {
    expect(jump).toContain("const OVERLAY_RELEASE_MS = 7000");
    expect(jump).toContain("overlayReleaseTimer");
    expect(jump).toContain('new CustomEvent("chat:jump-hydration-end")');
  });

  it("keeps the skeleton masking and exact-target selection intact", () => {
    expect(list).toContain("{!initialRevealReady ? <JumpHydrationSkeleton /> : null}");
    expect(list).toContain("initialTargetMessageId && initialTargetIndex >= 0");
  });
});
