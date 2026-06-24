import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ChatScopeType } from "@/hooks/useChatCatchUp";

/**
 * Resolves whether the AI Catch Me Up feature has been turned off either at
 * the club level (admin toggle) or for the current user (personal setting).
 * Direct messages have no owning club, so `clubDisabled` is always false there.
 */
export function useAICatchUpAvailability(
  scope_type: ChatScopeType,
  scope_id: string | null | undefined,
) {
  const { data: clubDisabled } = useQuery({
    queryKey: ["club-ai-catchup-flag", scope_type, scope_id],
    enabled: !!scope_id && scope_type !== "direct",
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let clubId: string | null = null;
      if (scope_type === "club") clubId = scope_id!;
      else if (scope_type === "team") {
        const { data } = await supabase.from("teams").select("club_id").eq("id", scope_id!).maybeSingle();
        clubId = (data?.club_id as string) ?? null;
      } else if (scope_type === "group") {
        const { data } = await supabase.from("chat_groups").select("club_id").eq("id", scope_id!).maybeSingle();
        clubId = (data?.club_id as string) ?? null;
      } else if (scope_type === "club_admin") {
        const { data } = await supabase.from("club_admin_conversations").select("club_id").eq("id", scope_id!).maybeSingle();
        clubId = (data?.club_id as string) ?? null;
      }
      if (!clubId) return false;
      const { data: club } = await supabase
        .from("clubs")
        .select("ai_catch_up_enabled")
        .eq("id", clubId)
        .maybeSingle();
      return (club as any)?.ai_catch_up_enabled === false;
    },
  });

  const { data: userDisabled } = useQuery({
    queryKey: ["user-ai-catchup-pref"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return false;
      const { data } = await supabase
        .from("profiles")
        .select("ai_catch_up_enabled")
        .eq("id", uid)
        .maybeSingle();
      return (data as any)?.ai_catch_up_enabled === false;
    },
  });

  return {
    clubDisabled: clubDisabled === true,
    userDisabled: userDisabled === true,
    featureDisabled: clubDisabled === true || userDisabled === true,
  };
}
