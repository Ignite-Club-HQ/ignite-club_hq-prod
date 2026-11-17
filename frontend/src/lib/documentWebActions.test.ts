import { beforeEach, describe, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false }, registerPlugin: vi.fn() }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({ resolveSignedUrl: resolve }));
import { runFileAction } from "./safeOpenFile";
beforeEach(() => { vi.restoreAllMocks(); resolve.mockReset(); resolve.mockImplementation(async url => url); });
describe("web document viewing", () => {
  it("opens the placeholder synchronously, then navigates only to authorized bytes", async () => {
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: { cancel: vi.fn() } }));
    const promise = runFileAction("open", "https://example.org/private.pdf");
    expect(open).toHaveBeenCalledWith("", "_blank");
    await promise;
    expect(tab.location.href).toBe("https://example.org/private.pdf");
    expect(tab.opener).toBeNull();
  });
  it("reports a blocked popup instead of silently downloading or sharing", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await expect(runFileAction("open", "https://example.org/rules.pdf")).rejects.toThrow("blocked");
  });
  it("denied access closes the placeholder and never fetches raw bytes", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    resolve.mockRejectedValue(new Error("permission denied"));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(runFileAction("open", "https://example.org/private.pdf")).rejects.toThrow("access");
    expect(tab.close).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("expired links do not leave a blank viewing window", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(runFileAction("open", "https://example.org/expired.pdf")).rejects.toThrow("expired");
    expect(tab.close).toHaveBeenCalled();
  });
});