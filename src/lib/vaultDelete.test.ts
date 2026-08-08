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
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 1,
        filesDeleted: 0,
        succeeded: [{ id: "p1", kind: "photo" }],
        failed: [{ id: "f1", kind: "file", code: "storage_delete_failed" }],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["p1"], fileIds: ["f1"] });
    expect(r.succeeded).toEqual([{ id: "p1", kind: "photo" }]);
    expect(r.failed).toEqual([{ id: "f1", kind: "file", code: "storage_delete_failed" }]);
  });

  it("sends every requested ID exactly once and accumulates results across batches", async () => {
    const photoIds = Array.from({ length: VAULT_DELETE_CHUNK + 20 }, (_, i) => `p${i}`);
    invoke.mockImplementation((...args: any[]) => {
      const ids: string[] = args[1]?.body?.photoIds ?? [];
      return Promise.resolve(
        ok({
          photosDeleted: ids.length,
          filesDeleted: 0,
          succeeded: ids.map((id) => ({ id, kind: "photo" })),
          failed: [],
        }),
      );
    });
    const r = await permanentlyDeleteVaultItems({ photoIds });
    expect(invoke).toHaveBeenCalledTimes(2);
    const sent = invoke.mock.calls.flatMap((c: any[]) => c[1]?.body?.photoIds ?? []);
    expect(sent).toEqual(photoIds);
    expect(new Set(sent).size).toBe(photoIds.length);
    expect(r.succeeded).toHaveLength(photoIds.length);
  });

  it("deduplicates duplicate server entries by kind+id", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 3,
        filesDeleted: 0,
        succeeded: [
          { id: "p1", kind: "photo" },
          { id: "p1", kind: "photo" },
        ],
        failed: [
          { id: "p2", kind: "photo", code: "x" },
          { id: "p2", kind: "photo", code: "x" },
        ],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["p1", "p2"] });
    expect(r.succeeded).toHaveLength(1);
    expect(r.failed).toHaveLength(1);
  });

  it("keeps photo and file identifiers with the same string ID distinct", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 1,
        filesDeleted: 1,
        succeeded: [
          { id: "same", kind: "photo" },
          { id: "same", kind: "file" },
        ],
        failed: [],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["same"], fileIds: ["same"] });
    expect(r.succeeded).toEqual([
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
    const r = await permanentlyDeleteVaultItems({});
    expect(invoke).not.toHaveBeenCalled();
    expect(r).toEqual({ photosDeleted: 0, filesDeleted: 0, succeeded: [], failed: [] });
  });

  it("ignores malformed result entries", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 1,
        filesDeleted: 0,
        succeeded: [{ id: 42, kind: "photo" }, { id: "p1", kind: "sticker" }, { id: "p1", kind: "photo" }],
        failed: [{ id: "p2", kind: "photo" }],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["p1", "p2"] });
    expect(r.succeeded).toEqual([{ id: "p1", kind: "photo" }]);
    expect(r.failed).toEqual([{ id: "p2", kind: "photo", code: "unknown_error" }]);
  });
});
