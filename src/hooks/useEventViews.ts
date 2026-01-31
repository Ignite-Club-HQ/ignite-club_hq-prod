import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to track when a user views an event.
 * Records the view in the database on first view.
 */
export function useEventViewTracking(eventId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();

  // Check if user has already viewed this event
  const { data: hasViewed } = useQuery({
    queryKey: ["event-view-check", eventId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_views")
        .select("id")
        .eq("event_id", eventId!)
        .eq("user_id", userId!)
        .maybeSingle();
      
      if (error) {
        console.error("Error checking event view:", error);
        return false;
      }
      return !!data;
    },
    enabled: !!eventId && !!userId,
  });

  // Mutation to record the view
  const recordViewMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("event_views")
        .insert({
          event_id: eventId!,
          user_id: userId!,
        });
      
      // Ignore unique constraint violations (user already viewed)
      if (error && !error.message.includes("duplicate key")) {
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate queries so the UI updates
      queryClient.invalidateQueries({ queryKey: ["event-view-check", eventId, userId] });
      queryClient.invalidateQueries({ queryKey: ["event-views", eventId] });
      queryClient.invalidateQueries({ queryKey: ["user-event-views"] });
    },
  });

  // Record view when component mounts (if not already viewed)
  useEffect(() => {
    if (eventId && userId && hasViewed === false) {
      recordViewMutation.mutate();
    }
  }, [eventId, userId, hasViewed]);

  return { hasViewed };
}

/**
 * Hook to get the list of users who have/haven't viewed an event.
 * Only for admins.
 */
export function useEventViewsAdmin(eventId: string | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ["event-views", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_views")
        .select(`
          id,
          user_id,
          viewed_at
        `)
        .eq("event_id", eventId!);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!eventId && enabled,
  });
}

/**
 * Hook to get user's viewed event IDs for showing badges on event list
 */
export function useUserEventViews(userId: string | undefined, eventIds: string[] = []) {
  return useQuery({
    queryKey: ["user-event-views", userId, eventIds.sort().join(",")],
    queryFn: async () => {
      if (eventIds.length === 0) return new Set<string>();
      
      const { data, error } = await supabase
        .from("event_views")
        .select("event_id")
        .eq("user_id", userId!)
        .in("event_id", eventIds);
      
      if (error) throw error;
      return new Set(data?.map(v => v.event_id) || []);
    },
    enabled: !!userId && eventIds.length > 0,
  });
}