/**
 * Startup check for `public.vault_folders.deleted_at`.
 *
 * DISABLED 2026-05: the column has shipped everywhere and the probe started
 * hitting a statement timeout on cold app launch (vault_folders RLS is
 * expensive enough that even a `LIMIT 1` was 500ing). The 500 was the first
 * network request out of the gate on app boot and was holding up the auth
 * handshake / queryClient warmup. Kept as a no-op so existing callers stay
 * valid; remove the import next time we touch main.tsx.
 */
export async function checkVaultFoldersSchema(): Promise<void> {
  return;
}
