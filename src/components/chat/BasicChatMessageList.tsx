import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";

/**
 * Basic non-virtualised chat message list — emergency fallback used when an
 * app admin disables chat virtualisation via /admin/settings.
 *
 * Renders only the most recent 100 messages from the cached set as a plain
 * mapped list inside a single scroll container. Trades full-history scroll-up
 * and infinite pagination for predictable DOM and zero virtualiser cost,
 * which is useful as a kill-switch when a Virtuoso/Android freeze recurs.
 *
 * Implements the same `VirtualizedChatMessageListHandle` so chat pages can
 * use the two interchangeably without conditional ref logic.
 */

const MAX_RENDERED = 100;

export interface BasicChatMessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  isAtBottom: () => boolean;
  isNearBottom: (thresholdPx: number) => boolean;
}

interface Props<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderItem: (message: TMessage, index: number, arr: TMessage[]) => React.ReactNode;
  topPadding?: number;
  bottomPadding?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onAtBottomChange?: (atBottom: boolean) => void;
  scrollerRef?: (element: HTMLElement | Window | null) => void;
  initialBottomPinned?: boolean;
  currentUserId?: string | null;
}

function BasicChatMessageListInner<TMessage extends { id: string }>(
  {
    messages,
    hasOlder,
    isLoadingOlder: _isLoadingOlder,
    onLoadOlder: _onLoadOlder,
    renderItem,
    topPadding = 16,
    bottomPadding = 16,
    className,
    style,
    onAtBottomChange,
    scrollerRef,
    initialBottomPinned = true,
  }: Props<TMessage>,
  ref: React.Ref<BasicChatMessageListHandle>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const lastLengthRef = useRef(0);
  const [revealed, setRevealed] = useState(false);

  // Cap to most recent N messages to keep the DOM small on long histories.
  const visible = useMemo(() => {
    if (messages.length <= MAX_RENDERED) return messages;
    return messages.slice(messages.length - MAX_RENDERED);
  }, [messages]);

  const truncatedCount = messages.length - visible.length;

  const isAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  }, []);

  const isNearBottom = useCallback((thresholdPx: number) => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
  }, []);

  const scrollToBottomImpl = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior) => scrollToBottomImpl(behavior),
      scrollToIndex: (index, _align) => {
        const el = containerRef.current;
        if (!el) return;
        const child = el.querySelector<HTMLElement>(`[data-basic-row-index="${index}"]`);
        if (child) child.scrollIntoView({ block: "center" });
      },
      isAtBottom,
      isNearBottom,
    }),
    [isAtBottom, isNearBottom, scrollToBottomImpl],
  );

  // Initial pin to bottom on mount when requested.
  useLayoutEffect(() => {
    if (!initialBottomPinned) {
      setRevealed(true);
      return;
    }
    scrollToBottomImpl("auto");
    // Two-frame settle so any image with intrinsic dimensions has measured.
    requestAnimationFrame(() => {
      scrollToBottomImpl("auto");
      requestAnimationFrame(() => {
        scrollToBottomImpl("auto");
        setRevealed(true);
      });
    });
  }, [initialBottomPinned, scrollToBottomImpl]);

  // Auto-stick to bottom when new messages arrive and user is already there.
  useLayoutEffect(() => {
    const prev = lastLengthRef.current;
    lastLengthRef.current = visible.length;
    if (visible.length > prev && atBottomRef.current) {
      scrollToBottomImpl("auto");
    }
  }, [visible.length, scrollToBottomImpl]);

  // Wire scrollerRef so chat pages' scroll hooks can observe the element.
  useEffect(() => {
    scrollerRef?.(containerRef.current);
    return () => scrollerRef?.(null);
  }, [scrollerRef]);

  const handleScroll = useCallback(() => {
    const next = isAtBottom();
    if (next !== atBottomRef.current) {
      atBottomRef.current = next;
      onAtBottomChange?.(next);
    }
  }, [isAtBottom, onAtBottomChange]);

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={handleScroll}
      style={{
        height: "100%",
        width: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        opacity: revealed ? 1 : 0,
        transition: revealed ? "opacity 80ms ease-out" : "none",
        ...style,
      }}
    >
      <div style={{ height: topPadding }} />
      {(hasOlder || truncatedCount > 0) && (
        <div className="px-4 py-2 text-center text-xs text-muted-foreground">
          {truncatedCount > 0
            ? `Showing the most recent ${visible.length} of ${messages.length} messages (basic mode).`
            : "Older messages hidden in basic mode."}
        </div>
      )}
      {visible.map((message, index) => (
        <div key={message.id} data-basic-row-index={index}>
          {renderItem(message, index, visible)}
        </div>
      ))}
      <div style={{ height: typeof bottomPadding === "number" ? bottomPadding : undefined }}>
        {typeof bottomPadding === "string" ? (
          <div style={{ paddingBottom: bottomPadding }} />
        ) : null}
      </div>
      {_isLoadingOlder ? (
        <div className="flex justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}

export const BasicChatMessageList = forwardRef(BasicChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<BasicChatMessageListHandle> },
) => React.ReactElement;
