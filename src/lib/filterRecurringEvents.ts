/**
 * Limits recurring event series to only show the next N upcoming occurrences.
 * Non-recurring events pass through unchanged.
 * Events are assumed to be sorted by event_date ascending.
 */
export function filterRecurringEvents<
  T extends {
    id: string;
    parent_event_id: string | null;
    is_recurring: boolean;
    event_date: string;
  }
>(events: T[], maxPerSeries: number = 3): T[] {
  // Track how many occurrences we've kept per recurring series
  const seriesCounts = new Map<string, number>();

  return events.filter((event) => {
    // Non-recurring standalone events always pass through
    if (!event.parent_event_id && !event.is_recurring) {
      return true;
    }

    // Determine the series key (parent_event_id for children, own id for parent)
    const seriesKey = event.parent_event_id || event.id;

    const count = seriesCounts.get(seriesKey) || 0;
    if (count >= maxPerSeries) {
      return false;
    }
    seriesCounts.set(seriesKey, count + 1);
    return true;
  });
}
