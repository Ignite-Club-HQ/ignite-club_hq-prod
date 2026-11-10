import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveIcpTarget: vi.fn(() => ({ alias: "test-target" })),
  getCurrentInternetIdentity: vi.fn(),
  isBlobStoreConfigured: vi.fn(() => true),
  uploadBytesToBlobStore: vi.fn(),
  clubIdFromMediaPath: vi.fn((path: string) => path.startsWith("clubs/") ? path.split("/")[1] : null),
  encryptClubMedia: vi.fn(),
  encryptPiiValue: vi.fn(),
  isClubMediaLockSupported: vi.fn(() => true),
  grantLiveClubPiiRead: vi.fn(),
  grantLivePiiReadClub: vi.fn(),
  grantLivePiiReadCompetition: vi.fn(),
  registerLivePii: vi.fn(),
  sha256Hex: vi.fn(() => "hash"),
  resolveAuthBackend: vi.fn(() => "icp"),
}));

vi.mock("./internetIdentityAuth", () => ({
  getCurrentInternetIdentity: mocks.getCurrentInternetIdentity,
}));
vi.mock("./targetRegistry", () => ({
  getActiveIcpTarget: mocks.getActiveIcpTarget,
}));
vi.mock("./blobStoreUpload", () => ({
  isBlobStoreConfigured: mocks.isBlobStoreConfigured,
  uploadBytesToBlobStore: mocks.uploadBytesToBlobStore,
}));
vi.mock("./authBackendMode", () => ({ resolveAuthBackend: mocks.resolveAuthBackend }));
vi.mock("./piiVetKeys", () => ({
  clubIdFromMediaPath: mocks.clubIdFromMediaPath,
  encryptClubMedia: mocks.encryptClubMedia,
  encryptPiiValue: mocks.encryptPiiValue,
  isClubMediaLockSupported: mocks.isClubMediaLockSupported,
}));
vi.mock("./features/vault", () => ({
  grantLiveClubPiiRead: mocks.grantLiveClubPiiRead,
  grantLivePiiReadClub: mocks.grantLivePiiReadClub,
  grantLivePiiReadCompetition: mocks.grantLivePiiReadCompetition,
  registerLivePii: mocks.registerLivePii,
}));
vi.mock("./mediaDecrypt", () => ({ MEDIA_BLOB_PII_FIELD: "blob" }));
vi.mock("./blobStoreProtocol", () => ({ sha256Hex: mocks.sha256Hex }));
vi.mock("./mediaStorage", () => ({ orderBlobStoresForPath: () => ["media_blob_store"] }));

import { tryUploadMediaToBlobStore } from "./mediaUpload";

describe("tryUploadMediaToBlobStore competition scope", () => {
  const identity = { getPrincipal: () => "uploader-principal" };
  const target = { alias: "test-target" };
  const blobRef = { canister: "aaaaa-aa", path: "/clubs/club-1/photo.jpg", content_hash: "hash" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAuthBackend.mockReturnValue("icp");
    mocks.getActiveIcpTarget.mockReturnValue(target);
    mocks.getCurrentInternetIdentity.mockResolvedValue(identity);
    mocks.isBlobStoreConfigured.mockReturnValue(true);
    mocks.isClubMediaLockSupported.mockResolvedValue(true);
    mocks.encryptClubMedia.mockResolvedValue(new Uint8Array([1]));
    mocks.encryptPiiValue.mockResolvedValue(new Uint8Array([2]));
    mocks.registerLivePii.mockResolvedValue(undefined);
    mocks.grantLiveClubPiiRead.mockResolvedValue(undefined);
    mocks.grantLivePiiReadCompetition.mockResolvedValue(undefined);
    mocks.uploadBytesToBlobStore.mockResolvedValue({ url: "https://blob", blobRef });
    mocks.sha256Hex.mockResolvedValue("hash");
  });

  it("keeps bytes and PII registration on the supplied club group", async () => {
    const groupTarget = { alias: "club-b-group" } as never;
    const context = { target: groupTarget, identity: identity as never };
    await tryUploadMediaToBlobStore({ context, storagePath: "clubs/club-b/private.jpg", file: new Blob(["photo"]), mime: "image/jpeg", lock: "own" });
    expect(mocks.encryptPiiValue).toHaveBeenCalledWith(context, "clubs/club-b/private.jpg", "blob", expect.any(Uint8Array));
    expect(mocks.uploadBytesToBlobStore).toHaveBeenCalledWith(groupTarget, identity, "clubs/club-b/private.jpg", expect.any(Uint8Array), "image/jpeg");
    expect(mocks.registerLivePii.mock.calls[0][0]).toEqual(context);
    expect(mocks.getActiveIcpTarget).not.toHaveBeenCalled();
  });

  it("does not authorize an off-chain fallback when ICP storage is missing", async () => {
    mocks.isBlobStoreConfigured.mockReturnValue(false);
    await expect(tryUploadMediaToBlobStore({ storagePath: "avatars/account/photo.jpg", file: new Blob(["photo"]), mime: "image/jpeg" })).rejects.toThrow("storage");
    expect(mocks.uploadBytesToBlobStore).not.toHaveBeenCalled();
    expect(mocks.getCurrentInternetIdentity).not.toHaveBeenCalled();
  });

  it("does not authorize an off-chain fallback when the ICP session is unavailable", async () => {
    mocks.getCurrentInternetIdentity.mockResolvedValue(null);
    await expect(tryUploadMediaToBlobStore({ storagePath: "avatars/account/photo.jpg", file: new Blob(["photo"]), mime: "image/jpeg" })).rejects.toThrow("sign in");
    expect(mocks.encryptPiiValue).not.toHaveBeenCalled();
    expect(mocks.uploadBytesToBlobStore).not.toHaveBeenCalled();
  });

  it("preserves email storage fallback without an ICP store", async () => {
    mocks.resolveAuthBackend.mockReturnValue("supabase");
    mocks.isBlobStoreConfigured.mockReturnValue(false);
    await expect(tryUploadMediaToBlobStore({ storagePath: "photo.jpg", file: new Blob(["photo"]), mime: "image/jpeg" })).resolves.toBeNull();
  });

  it("preserves email storage fallback without an II identity", async () => {
    mocks.resolveAuthBackend.mockReturnValue("supabase");
    mocks.getCurrentInternetIdentity.mockResolvedValue(null);
    await expect(tryUploadMediaToBlobStore({ storagePath: "photo.jpg", file: new Blob(["photo"]), mime: "image/jpeg" })).resolves.toBeNull();
  });

  it("uses per-file encryption and a live competition grant for competition photos", async () => {
    await tryUploadMediaToBlobStore({
      storagePath: "clubs/club-1/photo.jpg",
      file: new Blob(["photo"], { type: "image/jpeg" }),
      mime: "image/jpeg",
      competitionId: "competition-1",
    });

    expect(mocks.encryptPiiValue).toHaveBeenCalledOnce();
    expect(mocks.encryptClubMedia).not.toHaveBeenCalled();
    expect(mocks.registerLivePii).toHaveBeenCalledOnce();
    expect(mocks.grantLivePiiReadCompetition).toHaveBeenCalledWith(
      { target, identity },
      "clubs/club-1/photo.jpg",
      "blob",
      "competition-1",
    );
    expect(mocks.grantLiveClubPiiRead).not.toHaveBeenCalled();
  });

  it("keeps ordinary club photos on the shared club-media key", async () => {
    await tryUploadMediaToBlobStore({
      storagePath: "clubs/club-1/photo.jpg",
      file: new Blob(["photo"], { type: "image/jpeg" }),
      mime: "image/jpeg",
    });

    expect(mocks.encryptClubMedia).toHaveBeenCalledWith(
      { target, identity },
      "club-1",
      expect.any(Uint8Array),
    );
    expect(mocks.encryptPiiValue).not.toHaveBeenCalled();
    expect(mocks.grantLivePiiReadCompetition).not.toHaveBeenCalled();
  });

  it.each([
    ["club-logos/club-1/logo.jpg", "clubs/club-1/logos/logo.jpg"],
    ["club-logos/club-1/team-1/logo.jpg", "clubs/club-1/logos/team-1/logo.jpg"],
    ["club-logos/team-requests/club-1/logo.jpg", "clubs/club-1/logos/team-requests/logo.jpg"],
  ])("encrypts new logo %s for every club member", async (storagePath, expectedPath) => {
    const context = { target, identity: identity as never };
    await tryUploadMediaToBlobStore({ context, storagePath, file: new Blob(["logo"]), mime: "image/jpeg" });
    expect(mocks.encryptClubMedia).toHaveBeenCalledWith(context, "club-1", expect.any(Uint8Array));
    expect(mocks.uploadBytesToBlobStore).toHaveBeenCalledWith(target, identity, expectedPath, expect.any(Uint8Array), "image/jpeg");
    expect(mocks.encryptPiiValue).not.toHaveBeenCalled();
  });

  it("does not claim a member-visible logo if the club key is unavailable", async () => {
    mocks.isClubMediaLockSupported.mockResolvedValue(false);
    await expect(tryUploadMediaToBlobStore({ context: { target, identity: identity as never }, storagePath: "clubs/club-1/logos/logo.jpg", file: new Blob(["logo"]), mime: "image/jpeg" })).rejects.toThrow("club members");
    expect(mocks.encryptPiiValue).not.toHaveBeenCalled();
    expect(mocks.uploadBytesToBlobStore).not.toHaveBeenCalled();
  });

  it("rejects files above 10 MiB before encryption or upload", async () => {
    await expect(tryUploadMediaToBlobStore({
      storagePath: "clubs/club-1/vault/file.pdf",
      file: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]),
      mime: "application/pdf",
      lock: "own",
    })).rejects.toThrow("larger than 10 MB");
    expect(mocks.encryptPiiValue).not.toHaveBeenCalled();
    expect(mocks.uploadBytesToBlobStore).not.toHaveBeenCalled();
  });

  it("accepts a file exactly 10 MiB before encryption framing", async () => {
    await tryUploadMediaToBlobStore({
      storagePath: "clubs/club-1/vault/file.pdf",
      file: new Blob([new Uint8Array(10 * 1024 * 1024)]),
      mime: "application/pdf",
      lock: "own",
    });
    expect(mocks.uploadBytesToBlobStore).toHaveBeenCalledOnce();
  });
  it("does not swallow a private Vault club-grant refusal", async () => {
    const privateTarget = { alias: "test-target", canisterIds: { media_blob_store: "store" } } as never;
    const beforeUpload = vi.fn().mockResolvedValue(undefined);
    mocks.grantLivePiiReadClub.mockRejectedValueOnce(new Error("Club grant refused"));
    await expect(tryUploadMediaToBlobStore({ context: { target: privateTarget, identity: identity as never }, storagePath: "clubs/club-1/vault/file.pdf", file: new Blob(["file"]), mime: "application/pdf", lock: "own", beforeUpload })).rejects.toThrow("Club grant refused");
    expect(beforeUpload).toHaveBeenCalled();
    expect(mocks.grantLiveClubPiiRead).not.toHaveBeenCalled();
  });
});