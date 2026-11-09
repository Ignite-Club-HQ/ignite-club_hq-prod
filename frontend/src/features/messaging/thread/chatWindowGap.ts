/**
 * Decides which previously rendered rows may be kept when a fresh "latest
 * page" arrives. Keeping rows that are older than the page with no overlap
 * would leave a silent hole (messages sent while away are never fetched,
 * because "load older" walks back from the oldest rendered row).
 */
type Row = { id: string; created_at: string };

const isLocalOnly = (id: string) => id.startsWith("temp-") || id.startsWith("queued-");

export function dropRowsBehindGap<T extends Row>(previous: T[], incoming: Row[], incomingHasOlder: boolean): T[] {
  const realIncoming = incoming.filter((m) => !isLocalOnly(m.id));
  if (!incomingHasOlder || realIncoming.length === 0) return previous;
  const incomingIds = new Set(realIncoming.map((m) => m.id));
  // Overlap proves the earlier window joins on to the new page.
  if (previous.some((m) => incomingIds.has(m.id))) return previous;
  const oldestIncoming = Math.min(...realIncoming.map((m) => new Date(m.created_at).getTime()));
  return previous.filter((m) => isLocalOnly(m.id) || new Date(m.created_at).getTime() >= oldestIncoming);
}
