import { getActiveSupabaseTarget } from "@/live/targetRegistry";

/**
 * The live build only exposes IGNITE_LIVE_* settings, so VITE_SUPABASE_* is
 * always empty there. Reading it directly made Vault say "Storage is not
 * configured" and let stalled storage checks run with no deadline. Always use
 * the active backend target instead.
 */
export function supabaseOrigin(): string {
  try { return String(getActiveSupabaseTarget()?.url ?? "").replace(/\/+$/, ""); } catch { return ""; }
}

export function supabasePublishableKey(): string {
  try { return String(getActiveSupabaseTarget()?.anonKey ?? ""); } catch { return ""; }
}
