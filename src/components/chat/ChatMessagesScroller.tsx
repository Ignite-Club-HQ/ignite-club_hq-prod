import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "@/components/chat/VirtualizedChatMessageList";
import { markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { isChatJumpActive } from "@/lib/chatJumpActive";

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
  /** Disable the mount-time bottom pin when a deep-link jump owns first paint. */
  initialBottomPinned?: boolean;

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
    initialBottomPinned = true,
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
  // 36 instead of 16 so a reaction pill on the last message (which hangs
  // ~20px below the bubble) doesn't get clipped by the composer.
  const COMPOSER_GAP = 36;
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
  const mountBoxRef = useRef<HTMLDivElement>(null);

  // Virtuoso owns its own scroller; no external ref handover (legacy chat
  // hooks that mutated `scrollTop` directly are gone).
  const setVirtualScrollerRef = useCallback((_element: HTMLElement | Window | null) => {
    // intentional no-op
  }, []);

  // Always mount the list. When messages are already cached (warm open) the
  // list reveals instantly. On a cold first open after login the list's own
  // skeleton renders until messages arrive and the stabilisation completes.
  const virtualReady = true;

  // Open-time auto-adjustment is intentionally OFF. Virtuoso's own
  // `initialTopMostItemIndex={LAST}` + initialBottomPinned already lands the
  // chat at the bottom on first paint. Any parent-driven `scrollToBottom` just re-pins
  // against an already-pinned list and reads as content bouncing.
  //
  // We still react to POST-MOUNT transitions of `isKeyboardOpen` and to a
  // reply/edit composer growth, because in those cases the viewport shrinks
  // out from under the latest message and the user expects it to stay
  // visible. Mount-time changes to these values are ignored via the quiet
  // window. We do NOT re-pin on `lastMessageId` / `virtualReady` / `bottomPad`
  // changes — Virtuoso's `followOutput` covers new appends when at-bottom.
  const prevKeyboardOpenRef = useRef(isKeyboardOpen);
  const prevComposerHeightRef = useRef(composerHeight);
  useEffect(() => {
    if (!initialBottomPinned) {
      prevKeyboardOpenRef.current = isKeyboardOpen;
      prevComposerHeightRef.current = composerHeight;
      return;
    }
    if (!virtualReady) {
      prevKeyboardOpenRef.current = isKeyboardOpen;
      prevComposerHeightRef.current = composerHeight;
      return;
    }
    const handle = virtualHandleRef.current;
    if (!handle) return;
    // Initial-mount quiet window: let Virtuoso's own bottom pin own first
    // paint without ANY parent-driven re-snaps.
    if (performance.now() - mountedAtRef.current < INITIAL_MOUNT_QUIET_MS) {
      prevKeyboardOpenRef.current = isKeyboardOpen;
      prevComposerHeightRef.current = composerHeight;
      return;
    }

    const keyboardChanged = prevKeyboardOpenRef.current !== isKeyboardOpen;
    const previousComposerHeight = prevComposerHeightRef.current;
    const composerGrew = composerHeight - previousComposerHeight > 4;
    prevKeyboardOpenRef.current = isKeyboardOpen;
    prevComposerHeightRef.current = composerHeight;

    if (!keyboardChanged && !composerGrew) return;

    const wasNearBottom = handle.isNearBottom(180);
    if (!composerGrew && !wasNearBottom) return;

    const pin = () => {
      if (isChatJumpActive()) return;
      handle.scrollToBottom("auto");
      markChatScrollWrite();
    };
    pin();
    // Reply banners and mobile keyboards both resize the fixed composer in
    // stages; keep re-pinning while that animation settles so the latest
    // bubble remains above the input instead of underneath it.
    const timers = [120, 280, 520].map((delay) =>
      window.setTimeout(() => {
        if (handle.isNearBottom(240) || composerGrew) pin();
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [virtualReady, isKeyboardOpen, composerHeight, virtualHandleRef, initialBottomPinned]);

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
      ref={mountBoxRef}
      className="flex-1 min-h-0 overflow-hidden"
      data-chat-virtualized="true"
    >
      {virtualReady ? (
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
          initialBottomPinned={initialBottomPinned && (virtualReady || isPinned)}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
}
