import { describe, it, expect, vi } from "vitest";
import { withAttachDeadline } from "./ChatImageInput";

describe("withAttachDeadline", () => {
  it("releases a stalled upload step with a readable message instead of hanging", async () => {
    vi.useFakeTimers();
    const stalled = withAttachDeadline("storage-upload", 1000, new Promise(() => {}));
    vi.advanceTimersByTime(1001);
    await expect(stalled).rejects.toThrow("Check the Vault before trying again");
    vi.useRealTimers();
  });
  it("passes through a step that finishes in time", async () => {
    await expect(withAttachDeadline("competition-host", 1000, Promise.resolve(7))).resolves.toBe(7);
  });
});
