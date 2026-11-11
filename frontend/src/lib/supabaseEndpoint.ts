import { getActiveSupabaseTarget } from "@/live/targetRegistry";

/**
 * The live build only exposes IGNITE_LIVE_* settings, so VITE_SUPABASE_* is
 * always empty there. Reading it directly made Vault say "Storage is not
 * configured" and let stalled storage checks run with no deadline. Use the
 * active backend target; an explicitly provided VITE value (legacy/tests)
 * still wins.
 */
function env(): Record<string, unknown> {
  return ((import.meta as unknown as { env?: Record<string, unknown> }).env) ?? {};
}

export function supabaseOrigin(): string {
  const e = env();
  if ("VITE_SUPABASE_URL" in e) return String(e.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  try { return String(getActiveSupabaseTarget()?.url ?? "").replace(/\/+$/, ""); } catch { return ""; }
}

export function supabasePublishableKey(): string {
  const e = env();
  if ("VITE_SUPABASE_PUBLISHABLE_KEY" in e) return String(e.VITE_SUPABASE_PUBLISHABLE_KEY ?? "");
  try { return String(getActiveSupabaseTarget()?.anonKey ?? ""); } catch { return ""; }
}
