import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  begin_upload: vi.fn(), put_chunk: vi.fn(), finalize_upload: vi.fn(), abort_upload: vi.fn(), get_club_media_bytes: vi.fn(), get_club_media_usage: vi.fn(),
  stores: ['media_blob_store'],
}));
vi.mock("./icpAgent", () => ({ createLiveActor: vi.fn(async () => ({ actor: mocks, canisterId: { toText: () => "store" } })) }));
vi.mock("./mediaStorage", () => ({
  MEDIA_BLOB_STORE_KEY: "media_blob_store", listBlobStoreKeys: () => mocks.stores,
  orderBlobStoresForPath: () => ["media_blob_store"], blobAssetUrl: (_id: string, path: string) => `https://store/${path}`,
}));
import { uploadBytesToBlobStore } from "./blobStoreUpload";
import { sha256Hex } from "./blobStoreProtocol";
import type { IcpTargetConfig } from "./targetRegistry";
import type { Identity } from "@icp-sdk/core/agent";
const target = { canisterIds: { media_blob_store: "store" } } as unknown as IcpTargetConfig;
const identity = {} as Identity;
const bytes = new Uint8Array([1, 2, 3]);
const path = "clubs/c/photo.jpg";
describe("recoverable shared-quota uploads", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.stores = ['media_blob_store'];
    mocks.begin_upload.mockResolvedValue({ Ok: "upload-1" });
    mocks.put_chunk.mockResolvedValue({ Ok: null });
    mocks.abort_upload.mockResolvedValue({ Ok: null });
    mocks.finalize_upload.mockResolvedValue({ Ok: { path, content_hash: await sha256Hex(bytes), content_length: 3n } });
  });
  it("retries a lost begin acknowledgement with identical terms on the same store", async () => {
    mocks.begin_upload.mockRejectedValueOnce(new Error("lost response"));
    const result = await uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg");
    expect(result.blobRef.path).toBe(path);
    expect(mocks.begin_upload).toHaveBeenCalledTimes(2);
    expect(mocks.begin_upload.mock.calls[0]).toEqual(mocks.begin_upload.mock.calls[1]);
  });
  it("persists the exact ciphertext hash before reserving byte storage", async () => {
    const before = vi.fn(async ref => {
      expect(mocks.begin_upload).not.toHaveBeenCalled();
      expect(ref).toEqual({ canister: "store", path, content_hash: await sha256Hex(bytes) });
    });
    await uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg", before);
    expect(before).toHaveBeenCalledOnce();
  });
  it("does not send bytes or abort anything when the durable intent result is unknown", async () => {
    await expect(uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg", async () => { throw new Error("intent outcome unknown"); })).rejects.toThrow("intent outcome unknown");
    expect(mocks.begin_upload).not.toHaveBeenCalled();
    expect(mocks.put_chunk).not.toHaveBeenCalled();
    expect(mocks.abort_upload).not.toHaveBeenCalled();
  });
  it("retries the exact finalization after a lost commit response without aborting", async () => {
    mocks.finalize_upload.mockRejectedValueOnce(new Error("quota commit outcome unknown"));
    const result = await uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg");
    expect(result.blobRef.content_hash).toBe(await sha256Hex(bytes));
    expect(mocks.finalize_upload.mock.calls).toEqual([["upload-1"], ["upload-1"]]);
    expect(mocks.abort_upload).not.toHaveBeenCalled();
  });
  it("never releases an upload whose finalization outcome remains unknown", async () => {
    mocks.finalize_upload.mockRejectedValue(new Error("unknown outcome"));
    await expect(uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg")).rejects.toThrow("unknown outcome");
    expect(mocks.abort_upload).not.toHaveBeenCalled();
  });
  it("aborts chunk failures before any finalization starts", async () => {
    mocks.put_chunk.mockRejectedValue(new Error("chunk failed"));
    await expect(uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg")).rejects.toThrow("chunk failed");
    expect(mocks.abort_upload).toHaveBeenCalledWith("upload-1");
    expect(mocks.finalize_upload).not.toHaveBeenCalled();
  });
});
describe('complete photo usage reads', () => {
  const rows = ['gallery_photo', 'chat_photo', 'chat_file', 'vault'].map(category => ({ category, count: 5n, bytes: 100n, count_limit: 10n, bytes_limit: [] }));
  it('sums both configured stores rather than granting a fresh allowance on failover', async () => {
    mocks.stores = ['media_blob_store', 'media_blob_store_2'];
    mocks.get_club_media_usage.mockResolvedValue(rows);
    const { getLiveClubMediaUsage } = await import('./blobStoreUpload');
    const usage = await getLiveClubMediaUsage(target, identity, 'club-a');
    expect(usage.gallery_photo.count).toBe(10);
    expect(usage.chat_photo.count).toBe(10);
  });
  it('refuses partial inventory when any configured store is unreachable', async () => {
    mocks.stores = ['media_blob_store', 'media_blob_store_2'];
    mocks.get_club_media_usage.mockResolvedValueOnce(rows).mockRejectedValueOnce(new Error('store unavailable'));
    const { getLiveClubMediaUsage } = await import('./blobStoreUpload');
    await expect(getLiveClubMediaUsage(target, identity, 'club-a')).rejects.toThrow('store unavailable');
  });
  it('refuses a missing category instead of displaying zero usage', async () => {
    mocks.stores = ['media_blob_store'];
    mocks.get_club_media_usage.mockResolvedValue(rows.slice(1));
    const { getLiveClubMediaUsage } = await import('./blobStoreUpload');
    await expect(getLiveClubMediaUsage(target, identity, 'club-a')).rejects.toThrow('allowance');
  });
});
describe("Pro media allowance", () => {
  it("maps a full club media allowance to a friendly message", async () => {
    const { freeLimitMessage } = await import("./blobStoreUpload");
    expect(freeLimitMessage(new Error("Begin blob upload: StorageAllowanceFull"))).toMatch(/used all of its storage/);
    expect(freeLimitMessage(new Error("StorageAllowanceUnavailable"))).toMatch(/couldn't check/);
  });
  it("sums finalized and pending club media bytes from the store", async () => {
    const { getLiveClubMediaBytes } = await import("./blobStoreUpload");
    mocks.get_club_media_bytes.mockResolvedValue({ finalized: 10n, pending: 2n });
    await expect(getLiveClubMediaBytes(target, identity, "club-a")).resolves.toEqual({ finalized: 10, pending: 2 });
    expect(mocks.get_club_media_bytes).toHaveBeenCalledWith("club-a");
  });
  it("preserves unreadable store failures rather than returning partial zero bytes", async () => {
    const { getLiveClubMediaBytes } = await import("./blobStoreUpload");
    mocks.get_club_media_bytes.mockRejectedValueOnce(new Error("store unavailable"));
    await expect(getLiveClubMediaBytes(target, identity, "club-a")).rejects.toThrow("store unavailable");
  });

});
