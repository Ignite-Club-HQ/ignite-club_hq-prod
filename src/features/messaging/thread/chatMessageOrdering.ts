export interface ChronologicalChatMessage {
  id: string;
  created_at: string;
}

/**
 * Return a chronologically ordered copy suitable for Realtime reconciliation.
 * Equal (or invalid) timestamps use immutable message id as the deterministic
 * tie-breaker retained by every chat surface.
 */
export function orderChatMessagesChronologically<TMessage extends ChronologicalChatMessage>(
  messages: readonly TMessage[],
): TMessage[] {
  return [...messages].sort(
    (left, right) =>
      (new Date(left.created_at).getTime() - new Date(right.created_at).getTime()) ||
      left.id.localeCompare(right.id),
  );
}
