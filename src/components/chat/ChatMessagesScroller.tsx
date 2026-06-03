import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "@/components/chat/VirtualizedChatMessageList";
import { useViewportHeightSettled } from "@/hooks/useViewportHeightSettled";
import { markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { isChatJumpActive, setChatJumpActive } from "@/lib/chatJumpActive";

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

function useSettledChatMountBox(quietMs: number = 240) {
  const ref = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(false);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const arm = () => {
      clearTimer();
      timerRef.current = window.setTimeout(() => setSettled(true), quietMs);
    };

    const measure = (force = false) => {
      rafRef.current = null;
      const rect = element.getBoundingClientRect();
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      if (next.width <= 0 || next.height <= 0) {
        clearTimer();
        setSettled(false);
        return;
      }

      const prev = lastSizeRef.current;
      const changed = Math.abs(next.width - prev.width) > 1 || Math.abs(next.height - prev.height) > 1;
      if (force || changed) {
        lastSizeRef.current = next;
        setSettled(false);
        arm();
      }
    };

    const onResize = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => measure(false));
    };

    measure(true);

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    observer?.observe(element);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      clearTimer();
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [quietMs]);

  return { ref, settled };
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
  // Matches WhatsApp / Messenger: the latest bubble sits ~16px above the
  // composer. The reaction pill that hangs ~20px below the bubble is allowed
  // to overlap the composer's translucent top edge (it's still readable, and
  // a 36px reserved gap made every sent message look stranded mid-screen
  // — feedback received from users comparing against Messenger).
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
  const { ref: mountBoxRef, settled: mountBoxSettled } = useSettledChatMountBox(260);

  // Virtuoso owns its own scroller; no external ref handover (legacy chat
  // hooks that mutated `scrollTop` directly are gone).
  const setVirtualScrollerRef = useCallback((_element: HTMLElement | Window | null) => {
    // intentional no-op
  }, []);

  // Wait for real data, visual viewport height, wrapper size, and composer
  // height to stop changing before mounting Virtuoso. If it mounts against an
  // interim height, its initial bottom-pin can visibly correct down/up/down.
  const viewportSettled = useViewportHeightSettled(180);
  const [initialViewportReleased, setInitialViewportReleased] = useState(false);
  const initialComposerSettled = isKeyboardOpen || initialLayoutSettled || Math.abs(layoutComposerHeight - composerHeight) <= 1;
  const initialMountReady = viewportSettled && mountBoxSettled && initialComposerSettled;
  const virtualReady = messages.length > 0 && (initialMountReady || initialViewportReleased);

  useEffect(() => {
    if (messages.length === 0) {
      setInitialViewportReleased(false);
      return;
    }
    if (messages.length > 0 && initialMountReady) {
      setInitialViewportReleased(true);
    }
  }, [initialMountReady, messages.length]);

  // Open-time auto-adjustment is intentionally OFF. Virtuoso's own
  // `initialTopMostItemIndex={LAST}` + initialBottomPinned already lands the
  // chat at the bottom on first paint, and `ChatMessagesScroller` holds the
  // wrapper at opacity:0 until the visual viewport + composer height have
  // settled. Any parent-driven `scrollToBottom` after that just re-pins
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
  const wasNearBottomBeforeLayoutRef = useRef(initialBottomPinned);
  useEffect(() => {
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

    // When the user activates the composer (keyboard opens) or the composer
    // grows (reply pill, multi-line input), they have signalled intent to
    // reply — release any in-flight notification/search jump so the keyboard
    // compensator can pin the latest message above the input area. The jump
    // landing has already served its purpose by this point.
    if ((keyboardChanged && isKeyboardOpen) || composerGrew) {
      if (isChatJumpActive()) setChatJumpActive(false);
    }

    // A notification/search deep-link owns the viewport until the user
    // explicitly activates the composer/reply UI. Before that, never issue a
    // generic `scrollToBottom()` because it races the target-message
    // `scrollToIndex`; after activation, the user's intent has changed to
    // replying, so the latest message should be pinned above the keyboard.
    const composerActivated = (keyboardChanged && isKeyboardOpen) || composerGrew;
    if (!initialBottomPinned && !composerActivated) return;

    const wasNearBottom = handle.isNearBottom(180);
    const shouldPreserveBottom =
      wasNearBottom ||
      wasNearBottomBeforeLayoutRef.current ||
      (keyboardChanged && handle.isNearBottom(720)) ||
      composerActivated;
    if (!composerGrew && !shouldPreserveBottom) return;

    const pin = () => {
      if (isChatJumpActive()) return;
      handle.scrollToBottom("auto", { force: composerActivated });
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
          onAtBottomChange={(atBottom) => {
            wasNearBottomBeforeLayoutRef.current = atBottom;
          }}
          scrollerRef={setVirtualScrollerRef}
          initialBottomPinned={initialBottomPinned && (virtualReady || isPinned)}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
}
