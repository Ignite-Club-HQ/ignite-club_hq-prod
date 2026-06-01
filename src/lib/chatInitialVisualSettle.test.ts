import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForChatVisualContentSettle } from "./chatInitialVisualSettle";

function makeRoot() {
  const root = document.createElement("div");
  Object.defineProperty(root, "clientHeight", { configurable: true, value: 600 });
  Object.defineProperty(root, "scrollHeight", { configurable: true, value: 1600 });
  document.body.appendChild(root);
  return root;
}

async function flushFrame(ms = 20) {
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

describe("waitForChatVisualContentSettle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("waits for pending images and loading placeholders before revealing", async () => {
    const root = makeRoot();
    const skeleton = document.createElement("div");
    skeleton.className = "animate-pulse";
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { configurable: true, value: false });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 0 });
    root.append(skeleton, img);

    const done = vi.fn();
    const cleanup = waitForChatVisualContentSettle(root, { quietMs: 100, maxMs: 1000 }, done);

    await flushFrame(250);
    expect(done).not.toHaveBeenCalled();

    skeleton.remove();
    Object.defineProperty(img, "complete", { configurable: true, value: true });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 120 });
    img.dispatchEvent(new Event("load"));

    await flushFrame(80);
    expect(done).not.toHaveBeenCalled();
    await flushFrame(60);
    expect(done).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("releases on the max wait even if an image never resolves", async () => {
    const root = makeRoot();
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { configurable: true, value: false });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 0 });
    root.appendChild(img);

    const done = vi.fn();
    waitForChatVisualContentSettle(root, { quietMs: 100, maxMs: 500 }, done);

    await flushFrame(499);
    expect(done).not.toHaveBeenCalled();
    await flushFrame(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});