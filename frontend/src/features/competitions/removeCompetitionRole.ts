import { supabase } from "@/integrations/supabase/client";
export interface CompetitionRoleRemoval { id: string; user_id: string; role: string; team_id?: string | null }
export function competitionRoleRemovalError(error: unknown) {
  const failure = error as { code?: string; message?: string } | null;
  const technicalMessage = failure?.message ?? String(error);
  const missingAction = failure?.code === "PGRST202" || /remove_exact_competition_role.*schema cache/i.test(technicalMessage);
  return {
    title: "Could not remove this role",
    description: missingAction
      ? "Leaving a competition role isn't available in this version yet. Your role hasn't changed. Please let the app administrator know."
      : "We couldn't confirm that this role was removed. Refresh the competition before trying again.",
    variant: "destructive" as const,
    technicalMessage,
  };
}
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