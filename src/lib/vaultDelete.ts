import { supabase } from "@/integrations/supabase/client";

/** Server-side batch bound for permanent-delete-photos. */
export const VAULT_DELETE_CHUNK = 100;

export interface VaultDeleteFailure {
  id: string;
  kind: "photo" | "file";
  code: string;
}

/**
 * Invoke the permanent-deletion function, chunked to the server's batch bound.
 * Aggregates per-item failures so partial success is surfaced, never swallowed.
 */
export async function permanentlyDeleteVaultItems(opts: {
  photoIds?: string[];
  fileIds?: string[];
  deletionType?: string;
}): Promise<{ photosDeleted: number; filesDeleted: number; failed: VaultDeleteFailure[] }> {
  const photoIds = Array.from(new Set(opts.photoIds ?? []));
  const fileIds = Array.from(new Set(opts.fileIds ?? []));
  const deletionType = opts.deletionType ?? "permanent";

  const batches: Array<{ photoIds: string[]; fileIds: string[] }> = [];
  const queue: Array<{ kind: "photo" | "file"; id: string }> = [
    ...photoIds.map((id) => ({ kind: "photo" as const, id })),
    ...fileIds.map((id) => ({ kind: "file" as const, id })),
  ];
  for (let i = 0; i < queue.length; i += VAULT_DELETE_CHUNK) {
    const slice = queue.slice(i, i + VAULT_DELETE_CHUNK);
    batches.push({
      photoIds: slice.filter((x) => x.kind === "photo").map((x) => x.id),
      fileIds: slice.filter((x) => x.kind === "file").map((x) => x.id),
    });
  }

  let photosDeleted = 0;
  let filesDeleted = 0;
  const failed: VaultDeleteFailure[] = [];

  for (const batch of batches) {
    const { data, error } = await supabase.functions.invoke("permanent-delete-photos", {
      body: { ...batch, deletionType },
    });
    if (error) throw new Error(error.message);
    const result = data as
      | { photosDeleted?: number; filesDeleted?: number; failed?: VaultDeleteFailure[] }
      | null;
    photosDeleted += result?.photosDeleted ?? 0;
    filesDeleted += result?.filesDeleted ?? 0;
    if (result?.failed?.length) failed.push(...result.failed);
  }

  return { photosDeleted, filesDeleted, failed };
}
