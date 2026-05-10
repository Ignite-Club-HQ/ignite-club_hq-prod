import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "@/components/chat/VirtualizedChatMessageList";
import { useViewportHeightSettled } from "@/hooks/useViewportHeightSettled";

/**
 * Shared scroller used by Team / Group / Club / Broadcast / ClubAdmin / DM
 * chat pages.
 *
 * Virtualisation is unconditional and end-to-end: react-virtuoso owns the
 * scroll container in normal viewing AND while search is active. Search
 * jump-to-message goes through `virtualHandleRef.current?.scrollToIndex(...)`
 * via `jumpToMessageInVirtualizedChat` — there is NO legacy mapped DOM and
 * no `document.getElementById('message-${id}')` lookup left.
 */
interface ChatMessagesScrollerProps<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderRow: (msg: TMessage, index: number, arr: TMessage[]) => ReactNode;

  // Layout / behaviour
  isPinned: boolean;
  isKeyboardOpen: boolean;
  searchOpen: boolean;
  composerHeight: number;
  currentUserId?: string | null;

  /** Forwarded for parity with existing call sites; not used in virtual mode. */
  loadTriggerStyle?: CSSProperties;

  /**
   * Imperative handle. The parent owns it and uses it to drive
   * `scrollToBottom`, `scrollToIndex`, `isAtBottom`, `isNearBottom`. Search
   * jump-to-message uses `scrollToIndex` via this handle.
   */
  virtualHandleRef?: RefObject<VirtualizedChatMessageListHandle>;
}

function useDebouncedNumber(value: number, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    if (Math.abs(value - debounced) <= 1) return;

    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [debounced, delayMs, value]);

  return debounced;
}

export function ChatMessagesScroller<TMessage extends { id: string }>(
  props: ChatMessagesScrollerProps<TMessage>,
) {
  const {
    messages,
    hasOlderMessages,
    isLoadingOlder,
    onLoadOlder,
    renderRow,
    isPinned,
    isKeyboardOpen,
    searchOpen,
    composerHeight,
    currentUserId,
    virtualHandleRef: externalVirtualHandleRef,
  } = props;

  // CRITICAL: the composer is `position: fixed` (NOT a flex sibling) and the
  // chat container's `height` only subtracts the bottom-nav offset / native
  // keyboard height — it does NOT subtract the composer's own height. That
  // means the bottom `composerHeight` pixels of the scroller always sit
  // behind the fixed composer. We must reserve that space inside the
  // scroller, otherwise the latest messages (and replies, where the
  // composer grows to ~100-140px with the reply pill) render off-screen
  // behind the input. Add a small breathing gap so the newest bubble
  // doesn't kiss the composer border.
  const COMPOSER_GAP = 16;
  const mountedAtRef = useRef<number>(performance.now());
  const INITIAL_MOUNT_QUIET_MS = 600;
  const [initialLayoutSettled, setInitialLayoutSettled] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setInitialLayoutSettled(true), INITIAL_MOUNT_QUIET_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  const layoutComposerHeight = useDebouncedNumber(
    composerHeight,
    !initialLayoutSettled && !isKeyboardOpen ? 180 : 0,
  );
  const safeComposer = Math.max(layoutComposerHeight, 56); // floor for first paint before measure
  const bottomPad = useMemo(
    () =>
      searchOpen
        ? 16
        : isKeyboardOpen
        ? safeComposer + COMPOSER_GAP
        : `calc(${safeComposer + COMPOSER_GAP}px + env(safe-area-inset-bottom, 0px))`,
    [searchOpen, isKeyboardOpen, safeComposer],
  );

  const internalVirtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const virtualHandleRef = externalVirtualHandleRef ?? internalVirtualHandleRef;

  // Virtuoso owns its own scroller; no external ref handover (legacy chat
  // hooks that mutated `scrollTop` directly are gone).
  const setVirtualScrollerRef = useCallback((_element: HTMLElement | Window | null) => {
    // intentional no-op
  }, []);

  // Wait for real data AND for the visual viewport height to stop changing
  // before revealing the list. If we mount Virtuoso while the URL bar /
  // status bar / keyboard are still settling, its initial bottom-pin lands
  // against an interim height and then re-pins when the height settles —
  // visible as a "land then jolt up/down" flicker. Holding the wrapper at
  // opacity:0 for ~120ms of viewport quiet eliminates the visible shift.
  const viewportSettled = useViewportHeightSettled(180);
  const [initialViewportReleased, setInitialViewportReleased] = useState(false);
  const virtualReady = messages.length > 0 && (viewportSettled || initialViewportReleased);
  const lastMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    if (messages.length > 0 && viewportSettled) {
      setInitialViewportReleased(true);
    }
  }, [messages.length, viewportSettled]);

  // Suppress the re-pin loop during the initial mount window. Virtuoso's own
  // `initialTopMostItemIndex={LAST}` + immediate/raf1/raf2 pin already lands
  // the chat at the bottom on open. The parent effect below would otherwise
  // also fire when `composerHeight` transitions from the 56px floor to its
  // measured value (~80–140px) right after mount via a ResizeObserver, and
  // schedule snap-to-bottom calls at 80/280/550/900ms. Those late snaps are
  // visible as content shifting after the chat opens. We arm the effect only
  // after the first ~600ms of mount, by which time the composer height has
  // settled and any further changes are real (keyboard / reply / edit).
  // When the keyboard opens/closes or the composer grows, the viewport
  // resizes underneath the virtualised list. If the user was at the bottom
  // we must re-pin to the latest message — otherwise the most recent
  // messages get hidden behind the keyboard and they "can't see what they
  // just sent". Fires immediately and again after the keyboard animation.
  useEffect(() => {
    if (!virtualReady) return;
    const handle = virtualHandleRef.current;
    if (!handle) return;
    // Initial-mount quiet window: let Virtuoso's own bottom pin own first
    // paint without parent-driven re-snaps.
    if (performance.now() - mountedAtRef.current < INITIAL_MOUNT_QUIET_MS) return;
    const isReplyOrEditResize = composerHeight > 64;
    const wasAtBottom = handle.isAtBottom();
    if (!isReplyOrEditResize && !wasAtBottom) return;

    // Re-pin guard: when the user starts a reply/edit (composer grows) we
    // ALWAYS want the latest message visible above the composer + keyboard,
    // even if the timing of `isAtBottom` flips false mid-resize. Otherwise
    // honour the user's scroll position.
    const shouldRepin = () =>
      handle.isAtBottom() || (isReplyOrEditResize && wasAtBottom);

    const pin = () => handle.scrollToBottom("auto");
    pin();

    // Schedule multiple re-pins to cover:
    //  - immediate composer height change (DOM commit)
    //  - keyboard animation start (~80ms)
    //  - keyboard mid-animation (~280ms)
    //  - keyboard fully settled on Android (~550ms — longest observed)
    //  - very-late visualViewport reflow on some Android keyboards (~900ms)
    const delays = [80, 280, 550, 900];
    const timeouts = delays.map((ms) =>
      window.setTimeout(() => {
        if (shouldRepin()) pin();
      }, ms),
    );

    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const onViewportResize = () => {
      if (shouldRepin()) pin();
    };
    vv?.addEventListener("resize", onViewportResize);

    return () => {
      timeouts.forEach((id) => window.clearTimeout(id));
      vv?.removeEventListener("resize", onViewportResize);
    };
  }, [virtualReady, isKeyboardOpen, composerHeight, bottomPad, lastMessageId, virtualHandleRef]);

  // Stable renderer identity — recreating it on every parent re-render
  // invalidates Virtuoso's `itemContent` and forces every visible row tree to
  // re-evaluate (defeats `memo` on ChatMessage). `renderRow` is captured by
  // ref so the parent's per-render closure changes don't churn this.
  const renderRowRef = useRef(renderRow);
  renderRowRef.current = renderRow;
  const renderVirtualRow = useCallback(
    (msg: TMessage, index: number, arr: TMessage[]) => (
      // `contain: layout` isolates each row's layout from siblings (so an
      // image decode or reaction update can't reflow the whole list and force
      // Virtuoso to chase with a paddingTop adjustment mid-scroll). We
      // intentionally do NOT add `paint` / `strict` / `content` here — those
      // would establish a containing block for `position: fixed` descendants,
      // which clips the FullscreenImageViewer to a single row instead of the
      // viewport when a chat image is tapped.
      // `data-message-id` is consumed by the e2e regression spec to assert
      // row order and per-row avatar containment under fast upward scroll.
      <div
        className="px-4 pt-4"
        data-message-id={msg.id}
        data-chat-row="true"
        style={{ contain: "layout" }}
      >
        {renderRowRef.current(msg, index, arr)}
      </div>
    ),
    [],
  );

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden"
      data-chat-virtualized="true"
      style={{ opacity: messages.length === 0 || virtualReady ? 1 : 0, transition: "opacity 120ms ease-out" }}
    >
      {messages.length === 0 || virtualReady ? (
        <VirtualizedChatMessageList
          ref={virtualHandleRef}
          messages={messages}
          hasOlder={hasOlderMessages}
          isLoadingOlder={isLoadingOlder}
          onLoadOlder={onLoadOlder}
          renderItem={renderVirtualRow}
          topPadding={0}
          bottomPadding={bottomPad}
          scrollerRef={setVirtualScrollerRef}
          initialBottomPinned={virtualReady || isPinned}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
}
