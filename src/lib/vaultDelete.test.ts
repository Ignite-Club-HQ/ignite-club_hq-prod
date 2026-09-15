import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: any[]) => invoke(...args) } },
}));

import { permanentlyDeleteVaultItems, VAULT_DELETE_CHUNK } from "@/lib/vaultDelete";

beforeEach(() => invoke.mockReset());

const ok = (body: any) => ({ data: body, error: null });

describe("permanentlyDeleteVaultItems", () => {
  it("returns explicit succeeded[] and failed[] entries", async () => {
    invoke.mockResolvedValue(ok({
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [{ id: "p1", kind: "photo" }],
      failed: [{ id: "f1", kind: "file", code: "storage_delete_failed" }],
    }));
    const result = await permanentlyDeleteVaultItems({ photoIds: ["p1"], fileIds: ["f1"] });
    expect(result.succeeded).toEqual([{ id: "p1", kind: "photo" }]);
    expect(result.failed).toEqual([{ id: "f1", kind: "file", code: "storage_delete_failed" }]);
  });

  it("deduplicates requested IDs and sends the intended deletion type", async () => {
    invoke.mockResolvedValue(ok({
      photosDeleted: 1,
      filesDeleted: 1,
      succeeded: [{ id: "photo-1", kind: "photo" }, { id: "file-1", kind: "file" }],
      failed: [],
    }));
    await permanentlyDeleteVaultItems({
      photoIds: ["photo-1", "photo-1"],
      fileIds: ["file-1", "file-1"],
      deletionType: "empty_trash",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("permanent-delete-photos", {
      body: {
        photoIds: ["photo-1"],
        fileIds: ["file-1"],
        deletionType: "empty_trash",
      },
    });
  });

  it("never exceeds the batch bound and sends mixed requested IDs exactly once", async () => {
    const photoIds = Array.from({ length: 75 }, (_, index) => `photo-${index}`);
    const fileIds = Array.from({ length: 137 }, (_, index) => `file-${index}`);
    invoke.mockResolvedValue(ok({
      photosDeleted: 0,
      filesDeleted: 0,
      succeeded: [],
      failed: [],
    }));

    await permanentlyDeleteVaultItems({ photoIds, fileIds });
    expect(invoke).toHaveBeenCalledTimes(3);
    const bodies = invoke.mock.calls.map((call: any[]) => call[1].body);
    expect(bodies.every((body: any) =>
      body.photoIds.length + body.fileIds.length <= VAULT_DELETE_CHUNK)).toBe(true);
    expect(bodies.flatMap((body: any) => body.photoIds)).toEqual(photoIds);
    expect(bodies.flatMap((body: any) => body.fileIds)).toEqual(fileIds);
  });

  it("accumulates explicit successes, counts and failures across batches", async () => {
    invoke
      .mockResolvedValueOnce(ok({
        photosDeleted: 60,
        filesDeleted: 40,
        succeeded: [
          ...Array.from({ length: 60 }, (_, i) => ({ id: `photo-${i}`, kind: "photo" })),
          ...Array.from({ length: 40 }, (_, i) => ({ id: `file-${i}`, kind: "file" })),
        ],
        failed: [],
      }))
      .mockResolvedValueOnce(ok({
        photosDeleted: 0,
        filesDeleted: 19,
        succeeded: Array.from({ length: 19 }, (_, i) => ({ id: `file-${40 + i}`, kind: "file" })),
        failed: [
          { id: "file-59", kind: "file", code: "denied" },
          { id: "file-60", kind: "file", code: "missing" },
        ],
      }));
    const result = await permanentlyDeleteVaultItems({
      photoIds: Array.from({ length: 60 }, (_, i) => `photo-${i}`),
      fileIds: Array.from({ length: 61 }, (_, i) => `file-${i}`),
    });
    expect(result.photosDeleted).toBe(60);
    expect(result.filesDeleted).toBe(59);
    expect(result.succeeded).toHaveLength(119);
    expect(result.failed).toEqual([
      { id: "file-59", kind: "file", code: "denied" },
      { id: "file-60", kind: "file", code: "missing" },
    ]);
  });

  it("deduplicates duplicate server entries by kind+id", async () => {
    invoke.mockResolvedValue(ok({
      photosDeleted: 3,
      filesDeleted: 0,
      succeeded: [{ id: "p1", kind: "photo" }, { id: "p1", kind: "photo" }],
      failed: [
        { id: "p2", kind: "photo", code: "x" },
        { id: "p2", kind: "photo", code: "x" },
      ],
    }));
    const result = await permanentlyDeleteVaultItems({ photoIds: ["p1", "p2"] });
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });

  it("keeps photo and file identifiers with the same string ID distinct", async () => {
    invoke.mockResolvedValue(ok({
      photosDeleted: 1,
      filesDeleted: 1,
      succeeded: [{ id: "same", kind: "photo" }, { id: "same", kind: "file" }],
      failed: [],
    }));
    const result = await permanentlyDeleteVaultItems({ photoIds: ["same"], fileIds: ["same"] });
    expect(result.succeeded).toEqual([
      { id: "same", kind: "photo" },
      { id: "same", kind: "file" },
    ]);
  });

  it("a failed invocation stops the operation instead of claiming later batches succeeded", async () => {
    const photoIds = Array.from({ length: VAULT_DELETE_CHUNK + 5 }, (_, i) => `p${i}`);
    invoke
      .mockResolvedValueOnce(ok({ photosDeleted: 0, filesDeleted: 0, succeeded: [], failed: [] }))
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(permanentlyDeleteVaultItems({ photoIds })).rejects.toThrow("boom");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("performs no invocation for an empty selection", async () => {
    const result = await permanentlyDeleteVaultItems({});
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      photosDeleted: 0,
      filesDeleted: 0,
      succeeded: [],
      failed: [],
    });
  });

  it("ignores malformed result entries", async () => {
    invoke.mockResolvedValue(ok({
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [
        { id: 42, kind: "photo" },
        { id: "p1", kind: "sticker" },
        { id: "p1", kind: "photo" },
      ],
      failed: [{ id: "p2", kind: "photo" }],
    }));
    const result = await permanentlyDeleteVaultItems({ photoIds: ["p1", "p2"] });
    expect(result.succeeded).toEqual([{ id: "p1", kind: "photo" }]);
    expect(result.failed).toEqual([{ id: "p2", kind: "photo", code: "unknown_error" }]);
  });
});
