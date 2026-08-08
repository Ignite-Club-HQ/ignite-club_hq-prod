import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

const DRIVE_IMPORT_ALLOWED_CLUB_IDS = new Set<string>([
  "966bdaec-ebf1-46da-b2b3-cc53bf05c422",
  "493ee2e3-c834-487d-93be-d1c8a0dbc4a8",
  "36231b76-5313-478e-b8d5-23ac4f5e8b10",
]);

export function isVaultDriveEnabled(clubId: string | null | undefined): boolean {
  return !!clubId && DRIVE_IMPORT_ALLOWED_CLUB_IDS.has(clubId);
}

export interface VaultDriveTitleSummary {
  scanned: number;
  updated: number;
  unresolved: number;
  errors: number;
  hasOAuth?: boolean;
}

export async function resolveVaultDriveTitles(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultDriveTitleSummary | undefined> {
  const { data, error } = await client.functions.invoke("resolve-drive-titles", {
    body: { clubId },
  });
  if (error) throw error;
  return (data as { summary?: VaultDriveTitleSummary } | null)?.summary;
}
