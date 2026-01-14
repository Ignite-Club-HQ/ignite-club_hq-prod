import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Hook to check if pitch board notifications are enabled for the current user.
 * Returns enabled status and a function to check preference.
 */
export function usePitchBoardNotifications() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true); // Default to enabled

  useEffect(() => {
    if (!user?.id) return;

    const loadPreference = async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("pitch_board_enabled")
        .eq("user_id", user.id)
        .single();

      if (data) {
        setEnabled(data.pitch_board_enabled ?? true);
      }
    };

    loadPreference();
  }, [user?.id]);

  return { pitchBoardNotificationsEnabled: enabled };
}

/**
 * Standalone function to check pitch board notification preference.
 * Use when you don't have access to React hooks.
 */
export async function checkPitchBoardNotificationsEnabled(userId: string): Promise<boolean> {
  if (!userId) return true; // Default to enabled if no user

  try {
    const { data } = await supabase
      .from("notification_preferences")
      .select("pitch_board_enabled")
      .eq("user_id", userId)
      .single();

    return data?.pitch_board_enabled ?? true;
  } catch {
    return true; // Default to enabled on error
  }
}
