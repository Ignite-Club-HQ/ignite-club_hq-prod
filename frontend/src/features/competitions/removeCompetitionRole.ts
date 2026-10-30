import { supabase } from "@/integrations/supabase/client";
export interface CompetitionRoleRemoval { id: string; user_id: string; role: string; team_id?: string | null }
export async function removeSupabaseCompetitionRole(competitionId: string, row: CompetitionRoleRemoval) {
  const { data, error } = await supabase.rpc("remove_exact_competition_role", {
    p_id: row.id, p_competition_id: competitionId, p_user_id: row.user_id, p_role: row.role,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Role removal was not confirmed. Refresh and try again.");
}
export const competitionRoleRefreshKeys = (id: string) => [
  ["competition-roles", id], ["competition-isadmin", id], ["icp-live-competition-isadmin", id],
  ["my-competitions"], ["competition"], ["icp-live-competition-settings", id],
  ["chat-groups"], ["my-chat-groups-with-messages"], ["competition-admin-inbox", id], ["competition-chats-links", id],
];