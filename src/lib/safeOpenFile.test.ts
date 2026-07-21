import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  safeOpenUrl: vi.fn(),
  resolveSignedUrl: vi.fn(),
  downloadFile: vi.fn(),
  getUri: vi.fn(),
  fileOpen: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));
vi.mock("./safeOpenUrl", () => ({ safeOpenUrl: mocks.safeOpenUrl }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({ resolveSignedUrl: mocks.resolveSignedUrl }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { downloadFile: mocks.downloadFile, getUri: mocks.getUri },
  Directory: { Cache: "CACHE" },
}));
vi.mock("@capacitor-community/file-opener", () => ({
  FileOpener: { open: mocks.fileOpen },
}));

import { safeOpenFile } from "./safeOpenFile";

const privateUrl =
  "https://project.example/storage/v1/object/public/documents/clubs/club-1/team-sheet.pdf";

describe("safeOpenFile authorization and native fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.safeOpenUrl.mockResolvedValue(undefined);
    mocks.resolveSignedUrl.mockResolvedValue("https://signed.example/team-sheet.pdf?token=signed");
    mocks.downloadFile.mockResolvedValue({ path: "file:///cache/team-sheet.pdf" });
    mocks.getUri.mockResolvedValue({ uri: "file:///cache/fallback.pdf" });
    mocks.fileOpen.mockResolvedValue(undefined);
    vi.spyOn(Date, "now").mockReturnValue(1_234_567_890);
  });

  it("delegates directly to safe URL opening on web", async () => {
    mocks.isNativePlatform.mockReturnValue(false);

    await safeOpenFile(privateUrl);

    expect(mocks.safeOpenUrl).toHaveBeenCalledWith(privateUrl);
    expect(mocks.resolveSignedUrl).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.fileOpen).not.toHaveBeenCalled();
  });

  it("signs a private storage URL before native download", async () => {
    await safeOpenFile(privateUrl, { fileName: "Team sheet.pdf" });

    expect(mocks.resolveSignedUrl).toHaveBeenCalledWith(privateUrl);
    expect(mocks.downloadFile).toHaveBeenCalledWith({
      url: "https://signed.example/team-sheet.pdf?token=signed",
      path: "vault-1234567890-Team_sheet.pdf",
      directory: "CACHE",
    });
    expect(mocks.fileOpen).toHaveBeenCalledWith({
      filePath: "file:///cache/team-sheet.pdf",
      contentType: "application/pdf",
      openWithDefault: true,
    });
  });

  it("does not invoke signing for an ordinary external file URL", async () => {
    const url = "https://cdn.example/public/rules.pdf";

    await safeOpenFile(url);

    expect(mocks.resolveSignedUrl).not.toHaveBeenCalled();
    expect(mocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({ url }));
  });

  it.each([
    ["minutes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["scores.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["presentation.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["players.csv", "text/csv"],
    ["photo.jpeg", "image/jpeg"],
    ["unknown.bin", "application/octet-stream"],
  ])("infers the native content type for %s", async (fileName, contentType) => {
    await safeOpenFile(`https://cdn.example/${fileName}`);

    expect(mocks.fileOpen).toHaveBeenCalledWith(expect.objectContaining({ contentType }));
  });

  it("uses the explicitly supplied MIME type instead of filename inference", async () => {
    await safeOpenFile("https://cdn.example/download", {
      fileName: "download",
      mimeType: "application/vnd.custom",
    });

    expect(mocks.fileOpen).toHaveBeenCalledWith(expect.objectContaining({
      contentType: "application/vnd.custom",
    }));
  });

  it("sanitizes user-controlled filenames before writing to the native cache", async () => {
    await safeOpenFile("https://cdn.example/file.pdf", {
      fileName: "../../unsafe folder/club sheet?.pdf",
    });

    const path = mocks.downloadFile.mock.calls[0][0].path;
    expect(path).toBe("vault-1234567890-.._.._unsafe_folder_club_sheet_.pdf");
    expect(path).not.toContain("/");
  });

  it("resolves a local URI when native download does not return a path", async () => {
    mocks.downloadFile.mockResolvedValue({ path: undefined });

    await safeOpenFile("https://cdn.example/rules.pdf", { fileName: "rules.pdf" });

    expect(mocks.getUri).toHaveBeenCalledWith({
      path: "vault-1234567890-rules.pdf",
      directory: "CACHE",
    });
    expect(mocks.fileOpen).toHaveBeenCalledWith(expect.objectContaining({
      filePath: "file:///cache/fallback.pdf",
    }));
  });

  it("falls back to the browser with the signed URL when native opening fails", async () => {
    mocks.fileOpen.mockRejectedValue(new Error("viewer unavailable"));

    await safeOpenFile(privateUrl);

    expect(mocks.safeOpenUrl).toHaveBeenCalledWith(
      "https://signed.example/team-sheet.pdf?token=signed",
    );
    expect(mocks.safeOpenUrl).not.toHaveBeenCalledWith(privateUrl);
  });

  it("falls back to the browser when a public-file native download fails", async () => {
    const publicUrl = "https://cdn.example/rules.pdf";
    mocks.downloadFile.mockRejectedValue(new Error("download unavailable"));

    await safeOpenFile(publicUrl);

    expect(mocks.safeOpenUrl).toHaveBeenCalledWith(publicUrl);
    expect(mocks.fileOpen).not.toHaveBeenCalled();
  });

  it("must not download or expose a raw private URL when signing fails", async () => {
    mocks.resolveSignedUrl.mockRejectedValue(new Error("not authorized"));

    await expect(safeOpenFile(privateUrl)).rejects.toThrow();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.safeOpenUrl).not.toHaveBeenCalledWith(privateUrl);
  });
});
