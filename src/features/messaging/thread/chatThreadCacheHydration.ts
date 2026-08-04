import {
  mergeOlderChatMessagesChronologically,
  type ChronologicalChatMessage,
} from "./chatMessageOrdering";

/**
 * Merge notification/local-cache rows into an existing query snapshot while
 * preserving the existing row whenever both stores contain the same id.
 */
export function mergeCachedChatMessagesChronologically<
  TMessage extends ChronologicalChatMessage,
>(
  existingMessages: readonly TMessage[],
  cachedMessages: readonly TMessage[],
): TMessage[] {
  return mergeOlderChatMessagesChronologically(cachedMessages, existingMessages);
}
