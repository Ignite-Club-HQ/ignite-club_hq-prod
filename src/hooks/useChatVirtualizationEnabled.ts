import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * App-admin kill-switch for chat message virtualisation.
 *
 * Reads the `chat_virtualization_enabled` row from `public.app_settings`.
 * Defaults to ENABLED on any error/missing row so a transient fetch failure
 * never silently downgrades every chat to the basic fallback scroller.
 *
 * The flag is cached for 5 minutes per session — flipping it from
 * /admin/settings will take up to 5 min to propagate to active sessions
 * (or one hard reload).
 */
export function useChatVirtualizationEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["app-setting", "chat_virtualization_enabled"],
    queryFn: async () => {
      const { data: row } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "chat_virtualization_enabled")
        .maybeSingle();
      // Treat anything that isn't an explicit `false` as enabled.
      return row?.value !== false && row?.value !== "false";
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  // While loading or on error, assume enabled (safe default).
  return data !== false;
}
