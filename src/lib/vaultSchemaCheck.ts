import { supabase } from "@/integrations/supabase/client";

/**
 * Startup check: verify that public.vault_folders.deleted_at exists.
 * If the column is missing, the soft-delete filtering used throughout the
 * Vault feature will fail with PostgREST error 42703.
 *
 * This is a non-blocking, fire-and-forget probe — it only logs.
 */
export async function checkVaultFoldersSchema(): Promise<void> {
  try {
    const { error } = await supabase
      .from("vault_folders")
      .select("id, deleted_at")
      .limit(1);

    if (error) {
      const code = (error as any).code;
      const message = error.message || "";
      const missingColumn =
        code === "42703" ||
        (/deleted_at/i.test(message) && /does not exist|column/i.test(message));

      if (missingColumn) {
        console.error(
          "[VaultSchemaCheck] ❌ public.vault_folders.deleted_at is MISSING. " +
            "Vault soft-delete queries will fail. Apply migration: " +
            "ALTER TABLE public.vault_folders ADD COLUMN IF NOT EXISTS deleted_at timestamptz;",
          { code, message }
        );
      } else {
        // Other errors (RLS, network, auth) are not schema problems — log quietly.
        console.warn("[VaultSchemaCheck] probe returned a non-schema error:", {
          code,
          message,
        });
      }
      return;
    }

    console.log("[VaultSchemaCheck] ✅ vault_folders.deleted_at present");
  } catch (e) {
    console.warn("[VaultSchemaCheck] probe threw:", e);
  }
}
