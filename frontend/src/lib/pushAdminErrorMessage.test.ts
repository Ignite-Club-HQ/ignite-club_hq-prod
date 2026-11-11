import { describe, it, expect, vi } from "vitest";
import { pushAdminErrorMessage } from "./pushAdminErrorMessage";

describe("pushAdminErrorMessage", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  it("explains the app-admin refusal without raw text", () => {
    const m = pushAdminErrorMessage(new Error("Get push delivery health failed: App admin required"));
    expect(m).not.toMatch(/Get push delivery health failed/);
  });
  it("hides the raw admission rejection", () => {
    const m = pushAdminErrorMessage(new Error("Reject code: 4 Reject text: Account admission denied or unavailable Error code: IC0406"));
    expect(m).not.toMatch(/IC0406|Reject code/);
  });
});
