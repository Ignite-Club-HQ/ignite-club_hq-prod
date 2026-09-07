import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const capacitorMock = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
}));
const filesystemMock = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  getUri: vi.fn(async () => ({ uri: "file:///cache/x" })),
}));
const fileOpenerMock = vi.hoisted(() => ({ open: vi.fn() }));
const safeOpenUrlMock = vi.hoisted(() => vi.fn(async () => {}));
const resolveSignedUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitorMock.isNativePlatform(),
  },
}));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystemMock,
  Directory: { Cache: "CACHE" },
}));
vi.mock("@capacitor-community/file-opener", () => ({
  FileOpener: fileOpenerMock,
}));
vi.mock("./safeOpenUrl", () => ({ safeOpenUrl: safeOpenUrlMock }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({
  resolveSignedUrl: resolveSignedUrlMock,
}));

import { safeOpenFile } from "./safeOpenFile";

const RAW_PRIVATE =
  "https://xyz.supabase.co/storage/v1/object/public/photos/club/secret.pdf";
const SIGNED =
  "https://xyz.supabase.co/storage/v1/object/sign/photos/club/secret.pdf?token=SIGNED_TOKEN_ABC";

beforeEach(() => {
  vi.clearAllMocks();
  capacitorMock.isNativePlatform.mockReturnValue(true);
  filesystemMock.downloadFile.mockResolvedValue({ path: "file:///cache/x" });
  fileOpenerMock.open.mockResolvedValue(undefined);
});

describe("safeOpenFile — private URL fail-closed", () => {
  it("must not download or expose a raw private URL when signing fails", async () => {
    resolveSignedUrlMock.mockRejectedValueOnce(new Error("Unable to create signed URL"));

    await expect(safeOpenFile(RAW_PRIVATE)).rejects.toThrow();

    expect(filesystemMock.downloadFile).not.toHaveBeenCalled();
    expect(fileOpenerMock.open).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).not.toHaveBeenCalled();

    // Any thrown error must not leak the raw URL, tokens, or query params.
    try {
      await safeOpenFile(RAW_PRIVATE);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(RAW_PRIVATE);
      expect(msg).not.toContain("token");
      expect(msg).not.toContain("secret.pdf");
    }
  });

  it("signing failure triggers no native download or file opener", async () => {
    resolveSignedUrlMock.mockRejectedValue(new Error("signing failed"));
    await expect(safeOpenFile(RAW_PRIVATE)).rejects.toBeTruthy();
    expect(filesystemMock.downloadFile).not.toHaveBeenCalled();
    expect(fileOpenerMock.open).not.toHaveBeenCalled();
  });

  it("signing failure never sends the raw private URL to safeOpenUrl", async () => {
    resolveSignedUrlMock.mockRejectedValue(new Error("signing failed"));
    await expect(safeOpenFile(RAW_PRIVATE)).rejects.toBeTruthy();
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it.each([
    "/storage/v1/object/public/photos/a.pdf",
    "/storage/v1/object/sign/photos/a.pdf",
    "/storage/v1/object/authenticated/photos/a.pdf",
    "/storage/v1/render/image/public/photos/a.png",
    "/storage/v1/render/image/sign/photos/a.png",
  ])("every supported private storage URL form fails closed when signing fails: %s", async (path) => {
    resolveSignedUrlMock.mockRejectedValue(new Error("nope"));
    const url = `https://xyz.supabase.co${path}`;
    await expect(safeOpenFile(url)).rejects.toBeTruthy();
    expect(filesystemMock.downloadFile).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });
});

describe("safeOpenFile — successful signing", () => {
  it("downloads and opens using the signed URL, never the raw URL", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    await safeOpenFile(RAW_PRIVATE);

    expect(filesystemMock.downloadFile).toHaveBeenCalledTimes(1);
    const arg = filesystemMock.downloadFile.mock.calls[0][0];
    expect(arg.url).toBe(SIGNED);
    expect(fileOpenerMock.open).toHaveBeenCalledTimes(1);
  });

  it("retries generically when the viewer rejects the content type", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    fileOpenerMock.open.mockRejectedValueOnce(new Error("bad content type"));

    await safeOpenFile(RAW_PRIVATE);

    expect(fileOpenerMock.open).toHaveBeenCalledTimes(2);
    expect(fileOpenerMock.open.mock.calls[1][0].contentType).toBe("application/octet-stream");
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it("only falls back to the browser with the signed URL when the viewer fails twice", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    fileOpenerMock.open.mockRejectedValue(new Error("no viewer"));

    await safeOpenFile(RAW_PRIVATE);

    expect(safeOpenUrlMock).toHaveBeenCalledTimes(1);
    expect(safeOpenUrlMock).toHaveBeenCalledWith(SIGNED);
    expect(safeOpenUrlMock).not.toHaveBeenCalledWith(RAW_PRIVATE);
  });

  it("passes a bare extension file_type through the MIME guesser", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    await safeOpenFile(RAW_PRIVATE, { fileName: "Club policy.pdf", mimeType: "pdf" });
    expect(fileOpenerMock.open.mock.calls[0][0].contentType).toBe("application/pdf");
  });

});

describe("safeOpenFile — external / public non-storage URLs", () => {
  it("does not call the signer for external URLs and retains browser fallback", async () => {
    const externalUrl = "https://example.com/some/file.pdf";
    filesystemMock.downloadFile.mockRejectedValueOnce(new Error("download failed"));

    await safeOpenFile(externalUrl);

    expect(resolveSignedUrlMock).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).toHaveBeenCalledWith(externalUrl);
  });

  it("does not call the signer for external URLs on web", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(false);
    const externalUrl = "https://example.com/file.pdf";
    await safeOpenFile(externalUrl);
    expect(resolveSignedUrlMock).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).toHaveBeenCalledWith(externalUrl);
  });
});
