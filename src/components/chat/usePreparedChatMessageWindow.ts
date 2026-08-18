import { useEffect, useMemo } from "react";
import { prefetchChatImageAspectRatio } from "@/lib/chatImageAspectCache";
import { debugLogDuplicate, isChatVirtDebugEnabled } from "./chatVirtDebug";

export interface PreparedChatMessageWindow<TMessage> {
  uniqueMessages: TMessage[];
  indexById: Map<string, number>;
}

interface ImageMessage {
  image_url?: string | null;
  imageUrl?: string | null;
}

/** Keeps the first occurrence of every ID and preserves its resulting index. */
export function prepareChatMessageWindow<TMessage extends { id: string }>(
  messages: TMessage[],
): PreparedChatMessageWindow<TMessage> & { duplicateCounts: Map<string, number> } {
  const indexById = new Map<string, number>();
  const uniqueMessages: TMessage[] = [];
  const duplicateCounts = new Map<string, number>();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (indexById.has(message.id)) {
      duplicateCounts.set(message.id, (duplicateCounts.get(message.id) ?? 1) + 1);
      continue;
    }
    indexById.set(message.id, uniqueMessages.length);
    uniqueMessages.push(message);
  }

  return { uniqueMessages, indexById, duplicateCounts };
}

export function getChatMessageImageUrl(message: ImageMessage): string | null {
  return message.image_url ?? message.imageUrl ?? null;
}

/** Prepares the stable Virtuoso data window and warms image aspect ratios. */
export function usePreparedChatMessageWindow<TMessage extends { id: string }>(
  messages: TMessage[],
): PreparedChatMessageWindow<TMessage> {
  const prepared = useMemo(() => {
    const result = prepareChatMessageWindow(messages);
    if (result.duplicateCounts.size > 0 && isChatVirtDebugEnabled()) {
      for (const [id, count] of result.duplicateCounts) debugLogDuplicate(id, count);
    }
    return result;
  }, [messages]);

  useEffect(() => {
    for (const message of prepared.uniqueMessages) {
      const url = getChatMessageImageUrl(message as ImageMessage);
      if (url) prefetchChatImageAspectRatio(url);
    }
  }, [prepared.uniqueMessages]);

  return {
    uniqueMessages: prepared.uniqueMessages,
    indexById: prepared.indexById,
  };
}
