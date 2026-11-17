import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ platform: "android", save: vi.fn(), open: vi.fn(), share: vi.fn(), resolve: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => m.platform } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Filesystem: {
  downloadFile: vi.fn(async () => ({ path: "file:///cache/Rules.docx" })), stat: vi.fn(async () => ({ size: 32 })),
} }));
vi.mock("@capacitor-community/file-opener", () => ({ FileOpener: { open: m.open } }));
vi.mock("@capacitor/share", () => ({ Share: { share: m.share } }));
vi.mock("./nativeFileExport", () => ({ NativeFileExport: { save: m.save } }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({ resolveSignedUrl: m.resolve }));
import { runFileAction } from "./safeOpenFile";
beforeEach(() => { vi.clearAllMocks(); m.platform = "android"; m.resolve.mockImplementation(async u => u); m.save.mockResolvedValue({ saved: true }); m.open.mockResolvedValue(undefined); });
describe("native save/open dispatch", () => {
  it("Download calls platform export, not viewer or Share", async () => {
    await runFileAction("download", "https://example.org/Rules.docx");
    expect(m.save).toHaveBeenCalledWith({ filePath: "file:///cache/Rules.docx", fileName: "Rules.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(m.open).not.toHaveBeenCalled(); expect(m.share).not.toHaveBeenCalled();
  });
  it("save cancellation does not silently Share", async () => {
    m.save.mockResolvedValue({ saved: false });
    await runFileAction("download", "https://example.org/Rules.docx");
    expect(m.share).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
  });
  it("save failure is reported and never claims successful fallback", async () => {
    m.save.mockRejectedValue(new Error("destination denied"));
    await expect(runFileAction("download", "https://example.org/Rules.docx")).rejects.toThrow("couldn't save");
    expect(m.share).not.toHaveBeenCalled();
  });
  it("iOS Open uses preview, not the plugin's share/open-in branch", async () => {
    m.platform = "ios";
    await runFileAction("open", "https://example.org/Rules.pdf");
    expect(m.open).toHaveBeenCalledWith(expect.objectContaining({ contentType: "application/pdf", openWithDefault: true }));
    expect(m.share).not.toHaveBeenCalled();
  });
  it("denied authorization never caches or exports a file", async () => {
    m.resolve.mockRejectedValue(new Error("denied"));
    await expect(runFileAction("download", "https://example.org/private.docx")).rejects.toThrow("access");
    expect(m.save).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled(); expect(m.share).not.toHaveBeenCalled();
  });
});