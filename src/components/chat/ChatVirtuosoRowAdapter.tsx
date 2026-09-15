import { memo, type MutableRefObject, type ReactNode } from "react";
import { classifyChatRow, isChatVirtDebugEnabled } from "./chatVirtDebug";
import { ChatCachedMeasureRow } from "./ChatCachedMeasureRow";
import { ChatVirtuosoDebugProbe } from "./ChatVirtuosoDebugProbe";
import { estimateChatRowHeight } from "./chatRowHeightEstimator";

export type ChatRowAdapterMessage = { id: string };
export type ChatRowRender = (
  message: ChatRowAdapterMessage,
  index: number,
  messages: ChatRowAdapterMessage[],
) => ReactNode;

export type ChatVirtuosoRowAdapterProps = {
  message: ChatRowAdapterMessage;
  signature: string;
  renderItemRef: MutableRefObject<ChatRowRender>;
  uniqueMessagesRef: MutableRefObject<ChatRowAdapterMessage[]>;
  indexByIdRef: MutableRefObject<Map<string, number>>;
  currentUserIdRef: MutableRefObject<string | null | undefined>;
};

export const ChatVirtuosoRowAdapter = memo(
  function ChatVirtuosoRowAdapter({
    message,
    signature,
    renderItemRef,
    uniqueMessagesRef,
    indexByIdRef,
    currentUserIdRef,
  }: ChatVirtuosoRowAdapterProps) {
    const index = indexByIdRef.current.get(message.id);
    if (index === undefined) return null;
    const messages = uniqueMessagesRef.current;
    const child = renderItemRef.current(message, index, messages);
    const estimated = isChatVirtDebugEnabled()
      ? estimateChatRowHeight(message, index, messages, currentUserIdRef.current)
      : undefined;
    const measured = (
      <ChatCachedMeasureRow messageId={message.id} signature={signature}>
        {child}
      </ChatCachedMeasureRow>
    );
    if (estimated === undefined) return measured;
    const rowType = classifyChatRow(message as Parameters<typeof classifyChatRow>[0]);
    return (
      <ChatVirtuosoDebugProbe messageId={message.id} estimated={estimated} rowType={rowType}>
        {measured}
      </ChatVirtuosoDebugProbe>
    );
  },
  (previous, next) =>
    previous.signature === next.signature && previous.message.id === next.message.id,
);
