export type RsvpCompletionOptions = {
  eventId: string;
  teamId?: string | null;
  includeGroups?: boolean;
  includePitch?: boolean;
  includePoints?: boolean;
  schedule?: (callback: () => void, delayMs: number) => unknown;
};

/** Refresh only the RSVP-derived surfaces used by the caller's workflow. */
export function completeEventRsvp(
  queryClient: any,
  options: RsvpCompletionOptions,
): void {
  queryClient.invalidateQueries({ queryKey: ["event-rsvps", options.eventId] });
  queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", options.eventId] });
  if (options.includeGroups) {
    queryClient.invalidateQueries({ queryKey: ["event-groups", options.eventId] });
  }
  if (options.includePitch) {
    queryClient.invalidateQueries({
      queryKey: ["team-members-for-pitch", options.teamId, options.eventId],
    });
  }
  if (options.includePoints) {
    (options.schedule ?? setTimeout)(() => {
      queryClient.invalidateQueries({ queryKey: ["points-history"] });
      queryClient.invalidateQueries({ queryKey: ["points-rank"] });
      queryClient.invalidateQueries({ queryKey: ["points-rank-seasoned"] });
    }, 1500);
  }
}
