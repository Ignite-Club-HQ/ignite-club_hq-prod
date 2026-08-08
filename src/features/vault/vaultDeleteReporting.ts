/**
 * Truthful reporting for permanent Vault deletion (large-file cleanup).
 *
 * Server contract (`permanent-delete-photos`, wrapped by
 * `permanentlyDeleteVaultItems`):
 *   { photosDeleted: number; filesDeleted: number;
 *     failed: Array<{ id: string; kind: "photo" | "file"; code: string }> }
 * `failed[].id` is the same `photos.id` / `vault_files.id` that was sent, so
 * successful items are the requested set minus the failed set. Nothing is
 * estimated: freed bytes are summed over successful items only, and any
 * returned identifier we do not recognise is counted as a failure, never as a
 * deletion.
 */

export interface VaultDeleteCandidate {
  id: string;
  type: "photo" | "file";
  size: number;
}

export interface VaultDeleteServerResult {
  photosDeleted: number;
  filesDeleted: number;
  failed: Array<{ id: string; kind: "photo" | "file"; code: string }>;
}

export interface VaultDeleteSummary {
  deletedIds: string[];
  failedIds: string[];
  deletedCount: number;
  failedCount: number;
  freedBytes: number;
}

export function summarizeVaultDeletion(
  selected: VaultDeleteCandidate[],
  result: VaultDeleteServerResult,
): VaultDeleteSummary {
  const failedIds = new Set<string>();
  for (const f of result.failed || []) {
    if (f?.id) failedIds.add(f.id);
  }

  const deleted = selected.filter((item) => !failedIds.has(item.id));
  const requestedIds = new Set(selected.map((i) => i.id));
  // Identifiers the server reported that we never sent: fail safely — they are
  // surfaced as failures and can never inflate the deleted count.
  const unknownFailures = [...failedIds].filter((id) => !requestedIds.has(id));

  const serverDeleted = (result.photosDeleted || 0) + (result.filesDeleted || 0);
  const deletedCount = Math.min(deleted.length, serverDeleted);
  // Conservative: if the server acknowledged fewer deletions than our
  // id-difference implies, only count freed bytes for the acknowledged subset.
  const creditable = deletedCount === deleted.length ? deleted : deleted.slice(0, deletedCount);

  return {
    deletedIds: creditable.map((i) => i.id),
    failedIds: [
      ...selected.filter((i) => failedIds.has(i.id)).map((i) => i.id),
      ...unknownFailures,
    ],
    deletedCount,
    failedCount: selected.length - deletedCount,
    freedBytes: creditable.reduce((sum, i) => sum + (i.size || 0), 0),
  };
}

export type VaultDeleteOutcome = "success" | "partial" | "failure";

/** One toast per operation — success and error are never shown together. */
export function buildVaultDeleteMessage(
  summary: VaultDeleteSummary,
  formatSize: (bytes: number) => string,
): { outcome: VaultDeleteOutcome; message: string } {
  if (summary.deletedCount === 0) {
    return { outcome: "failure", message: `No files were deleted; ${summary.failedCount} failed` };
  }
  const base = `Deleted ${summary.deletedCount} file(s), freed ${formatSize(summary.freedBytes)}`;
  if (summary.failedCount > 0) {
    return { outcome: "partial", message: `${base}; ${summary.failedCount} failed` };
  }
  return { outcome: "success", message: base };
}
