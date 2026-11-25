import { describe, it, expect, vi } from "vitest";
import { mediaActionFailure } from "./mediaActionFailure";
import { retryMediaAdmission } from "../live/features/media";

describe("photo actions", () => {
  it("never shows raw server text", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = new Error("The replica returned a rejection error: Reject text: Account admission denied or unavailable Error code: IC0406");
    expect(mediaActionFailure(raw, "x")).not.toMatch(/replica|IC0406/);
  });
  it("retries an account-check refusal once", async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error("Account admission denied or unavailable")).mockResolvedValueOnce("ok");
    await expect(retryMediaAdmission(call, 0)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("does not retry other refusals", async () => {
    const call = vi.fn().mockRejectedValue(new Error("Invalid reaction kind"));
    await expect(retryMediaAdmission(call, 0)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });
});
