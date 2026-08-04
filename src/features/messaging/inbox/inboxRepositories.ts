import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

export async function fetchInboxAppAdminStatus(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "app_admin")
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function fetchInboxClubProStatus(
  clubIds: readonly string[],
  options: {
    client?: IgniteSupabaseClient;
    now?: number;
  } = {},
): Promise<Record<string, boolean>> {
  if (clubIds.length === 0) return {};

  const client = options.client ?? supabase;
  const { data: subscriptions, error } = await client
    .from("club_subscriptions")
    .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
    .in("club_id", [...clubIds]);

  if (error) throw error;

  const statusByClub: Record<string, boolean> = {};
  for (const clubId of clubIds) {
    const subscription = subscriptions?.find((item) => item.club_id === clubId);
    const hasProFlag = !!subscription && (
      subscription.is_pro ||
      subscription.is_pro_football ||
      subscription.admin_pro_override ||
      subscription.admin_pro_football_override
    );
    const isCurrent =
      !!subscription &&
      (
        !subscription.expires_at ||
        new Date(subscription.expires_at).getTime() > (options.now ?? Date.now())
      );
    statusByClub[clubId] = hasProFlag && isCurrent;
  }

  return statusByClub;
}

export async function fetchInboxCompetitionClubMap(
  competitionIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, Set<string>>> {
  if (competitionIds.length === 0) return {};

  const { data, error } = await client
    .from("competition_entries")
    .select("competition_id, teams:team_id(club_id)")
    .in("competition_id", [...competitionIds]);

  if (error) throw error;

  const clubIdsByCompetition: Record<string, Set<string>> = {};
  for (const row of data ?? []) {
    const clubId = row.teams?.club_id;
    if (!clubId) continue;
    (clubIdsByCompetition[row.competition_id] ||= new Set()).add(clubId);
  }
  return clubIdsByCompetition;
}
