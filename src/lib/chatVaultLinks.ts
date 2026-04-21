/**
 * Helpers for creating and parsing vault file/folder share tokens that travel
 * inside chat message text.
 *
 * Token formats:
 *   [vault:<file-uuid>]
 *   [vaultfolder:<folder-uuid>]
 */

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const VAULT_FILE_TOKEN_RE = new RegExp(`\\[vault:(${UUID_RE})\\]`, "gi");
export const VAULT_FOLDER_TOKEN_RE = new RegExp(`\\[vaultfolder:(${UUID_RE})\\]`, "gi");

export function makeVaultFileToken(fileId: string): string {
  return `[vault:${fileId}]`;
}

export function makeVaultFolderToken(folderId: string): string {
  return `[vaultfolder:${folderId}]`;
}

export function extractVaultFileIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const re = new RegExp(VAULT_FILE_TOKEN_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) ids.add(m[1].toLowerCase());
  }
  return [...ids];
}

export function extractVaultFolderIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const re = new RegExp(VAULT_FOLDER_TOKEN_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) ids.add(m[1].toLowerCase());
  }
  return [...ids];
}
