import { describe, expect, it, vi } from "vitest";
import { isChunkLoadFailure, recoverFromChunkFailure } from "./chunkRecovery";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("chunk recovery", () => {
  it("reloads only once per build, never loops", () => {
    const s = memoryStorage();
    const reload = vi.fn();
    expect(recoverFromChunkFailure(s, reload, "/assets/live-index-A.js")).toBe(true);
    expect(recoverFromChunkFailure(s, reload, "/assets/live-index-A.js")).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh reload after moving to a new build", () => {
    const s = memoryStorage();
    const reload = vi.fn();
    recoverFromChunkFailure(s, reload, "/assets/live-index-A.js");
    expect(recoverFromChunkFailure(s, reload, "/assets/live-index-B.js")).toBe(true);
  });

  it("recognises stale-chunk errors only", () => {
    expect(isChunkLoadFailure(new TypeError("Failed to fetch dynamically imported module: x.js"))).toBe(true);
    expect(isChunkLoadFailure(new Error("Access denied"))).toBe(false);
  });
});
