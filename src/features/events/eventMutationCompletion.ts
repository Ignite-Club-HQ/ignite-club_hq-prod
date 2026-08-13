import { refreshEventCaches } from "@/lib/eventCacheRefresh";
import { eventKeys } from "./eventQueryKeys";

type CompletionDependencies = {
  queryClient: any;
  navigate: (path: string) => void;
  userId?: string | null;
  warn?: (message: string, error: unknown) => void;
};

/** Complete a committed create without misreporting cache failure as write failure. */
export async function completeEventCreate(
  dependencies: CompletionDependencies,
  eventId: string,
): Promise<void> {
  try {
    await dependencies.queryClient.invalidateQueries({
      queryKey: eventKeys.home(dependencies.userId!),
    });
    refreshEventCaches(dependencies.queryClient, dependencies.userId);
  } catch (error) {
    dependencies.warn?.("Next Up invalidation failed after event creation:", error);
  }
  dependencies.navigate(`/events/${eventId}`);
}

/** Refresh every event and PitchBoard surface after a committed edit. */
export function completeEventEdit(
  dependencies: CompletionDependencies,
  eventId: string,
): void {
  dependencies.queryClient.invalidateQueries({ queryKey: eventKeys.pitchLinked(eventId) });
  dependencies.queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers() });
  dependencies.queryClient.invalidateQueries({ queryKey: eventKeys.pitchGoingRsvps(eventId) });
  dependencies.queryClient.invalidateQueries({ queryKey: eventKeys.detail(eventId) });
  refreshEventCaches(dependencies.queryClient, dependencies.userId);
  dependencies.navigate(`/events/${eventId}`);
}
