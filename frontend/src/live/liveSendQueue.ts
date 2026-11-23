/**
 * Sends to one chat run one after another on this device. Overlapping sends
 * each held a full set of cross-service access checks at once, so a quick
 * second message timed out, and could land before the first.
 */
const liveSendChains = new Map<string, Promise<unknown>>();
export function serializeLiveSend<T>(conversationId: string, run: () => Promise<T>): Promise<T> {
  const previous = liveSendChains.get(conversationId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  liveSendChains.set(conversationId, next);
  void next.catch(() => undefined).finally(() => { if (liveSendChains.get(conversationId) === next) liveSendChains.delete(conversationId); });
  return next;
}

/** Explicit refusal raised before anything was written: safe to send again with the same key. */
export function isNothingSentRefusal(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /authority unavailable; nothing was changed/i.test(message);
}
