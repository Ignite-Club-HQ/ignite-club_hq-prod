import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

import { permanentlyDeleteVaultItems, VAULT_DELETE_CHUNK } from "./vaultDelete";

describe("permanent Vault deletion batching", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing for an empty request", async () => {
    await expect(permanentlyDeleteVaultItems({})).resolves.toEqual({
      photosDeleted: 0, filesDeleted: 0, failed: [],
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("deduplicates ids and sends the intended deletion type", async () => {
    mocks.invoke.mockResolvedValue({ data: { photosDeleted: 1, filesDeleted: 1, failed: [] }, error: null });
    await permanentlyDeleteVaultItems({
      photoIds: ["photo-1", "photo-1"], fileIds: ["file-1", "file-1"], deletionType: "empty_trash",
    });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith("permanent-delete-photos", {
      body: { photoIds: ["photo-1"], fileIds: ["file-1"], deletionType: "empty_trash" },
    });
  });

  it("never exceeds the server batch bound and preserves every id exactly once", async () => {
    mocks.invoke.mockResolvedValue({ data: { photosDeleted: 0, filesDeleted: 0, failed: [] }, error: null });
    const photoIds = Array.from({ length: 75 }, (_, index) => `photo-${index}`);
    const fileIds = Array.from({ length: 137 }, (_, index) => `file-${index}`);
    await permanentlyDeleteVaultItems({ photoIds, fileIds });

    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    const bodies = mocks.invoke.mock.calls.map((call) => call[1].body);
    expect(bodies.every((body) => body.photoIds.length + body.fileIds.length <= VAULT_DELETE_CHUNK)).toBe(true);
    expect(bodies.flatMap((body) => body.photoIds)).toEqual(photoIds);
    expect(bodies.flatMap((body) => body.fileIds)).toEqual(fileIds);
  });

  it("aggregates success counts and per-item failures across all batches", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        data: { photosDeleted: 60, filesDeleted: 40, failed: [{ id: "file-40", kind: "file", code: "denied" }] }, error: null,
      })
      .mockResolvedValueOnce({
        data: { photosDeleted: 0, filesDeleted: 19, failed: [{ id: "file-60", kind: "file", code: "missing" }] }, error: null,
      });
    const result = await permanentlyDeleteVaultItems({
      photoIds: Array.from({ length: 60 }, (_, i) => `photo-${i}`),
      fileIds: Array.from({ length: 61 }, (_, i) => `file-${i}`),
    });
    expect(result).toEqual({
      photosDeleted: 60,
      filesDeleted: 59,
      failed: [
        { id: "file-40", kind: "file", code: "denied" },
        { id: "file-60", kind: "file", code: "missing" },
      ],
    });
  });

  it("stops and reports an invocation failure rather than claiming later batches succeeded", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "edge function unavailable" } });
    await expect(permanentlyDeleteVaultItems({ fileIds: ["file-1"] })).rejects.toThrow("edge function unavailable");
  });
});
