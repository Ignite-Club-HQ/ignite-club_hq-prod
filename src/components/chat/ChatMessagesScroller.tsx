import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "@/components/chat/VirtualizedChatMessageList";
import { useViewportHeightSettled } from "@/hooks/useViewportHeightSettled";
import { markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { isChatJumpActive, setChatJumpActive } from "@/lib/chatJumpActive";
import { resolveChatScrollViewport } from "@/lib/chatScroll";
import { debugLogEvent } from "@/components/chat/chatVirtDebug";


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
  /** Message that should be mounted on first paint for notification/search jumps. */
  initialTargetMessageId?: string | null;

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
    initialTargetMessageId = null,
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
  // Matches WhatsApp / Messenger: the latest bubble sits comfortably above the
  // composer. The latest own-message can render up to THREE stacked elements
  // below the bubble baseline:
  //   1. Reactions pill row (~30px when present: h-22 + mt-1 + mb-1)
  //   2. Inline timestamp (~16px)
  //   3. "Sent / Read by" frontier strip (~16px)
  // Read-frontier and reactions both hydrate AFTER Virtuoso's initial bottom
  // pin, so the row grows after pinning. We must reserve enough space below
  // the bubble that the late-arriving rows (especially reactions added by the
  // user on the latest message) stay clear of the fixed composer instead of
  // disappearing behind it. 56px keeps metadata + a single-row reaction pill
  // fully visible while still feeling tight (à la Messenger).
  const COMPOSER_GAP = 56;
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
  // The chat shell height already subtracts the bottom navigation / native
  // keyboard offset. The fixed composer overlaps the bottom of that shell by
  // exactly its own height in both states, so the virtual list should reserve
  // only composer height + the same compact breathing gap whether the keyboard
  // is open or closed. Adding `--bottom-nav-offset` here double-counts the nav
  // when the keyboard is closed and creates the oversized blank area reported
  // below the latest message metadata.
  const bottomPad = useMemo(
    () =>
      searchOpen
        ? 16
        : safeComposer + COMPOSER_GAP,
    [searchOpen, safeComposer],
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
      // Do NOT reset `initialViewportReleased` here — once the list has been
      // mounted, transient messages.length===0 frames (cache reseed, refetch
      // window collapse) would otherwise flip the inner-render gate to false,
      // unmount VirtualizedChatMessageList, and visibly jolt the chat back to
      // bottom a few seconds after the user finishes scrolling.
      return;
    }
    if (messages.length > 0 && initialMountReady) {
      setInitialViewportReleased(true);
    }
  }, [initialMountReady, messages.length]);

  // Latch the inner gate: once the list has been mounted for real, we must
  // never unmount it for transient ready-state changes (ResizeObserver-driven
  // mountBoxSettled flips, viewportSettled debounces after scroll, briefly
  // empty `messages` during cache reseed). Unmounting drops Virtuoso's scroll
  // position and forces a re-pin to bottom — the visible "jolt after stop"
  // bug. Once true, it stays true for the lifetime of this scroller instance.
  const hasMountedListRef = useRef(false);
  if (!hasMountedListRef.current && (messages.length === 0 || virtualReady)) {
    hasMountedListRef.current = true;
  }

  // Diagnostics: scroller component lifecycle
  useEffect(() => {
    debugLogEvent("scroller-mount", { messagesLen: messages.length });
    return () => debugLogEvent("scroller-unmount", { messagesLen: messages.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diagnostics: track when the inner gate (messages.length===0 || virtualReady) flips
  const prevGateRef = useRef<boolean | null>(null);
  const innerGate = messages.length === 0 || virtualReady;
  useEffect(() => {
    if (prevGateRef.current !== null && prevGateRef.current !== innerGate) {
      debugLogEvent("inner-gate-flip", {
        from: prevGateRef.current,
        to: innerGate,
        messagesLen: messages.length,
        virtualReady,
        initialMountReady,
        initialViewportReleased,
        viewportSettled,
        mountBoxSettled,
        initialComposerSettled,
      });
    }
    prevGateRef.current = innerGate;
  }, [innerGate, messages.length, virtualReady, initialMountReady, initialViewportReleased, viewportSettled, mountBoxSettled, initialComposerSettled]);

  // Diagnostics: track significant messages.length drops at the scroller level
  const prevMessagesLenRef = useRef(messages.length);
  useEffect(() => {
    const prev = prevMessagesLenRef.current;
    if (messages.length < prev - 5) {
      debugLogEvent("scroller-messages-shrink", { prev, next: messages.length });
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages.length]);

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
    // NOTE: do NOT early-return on `!virtualReady` here. On Android the
    // keyboard can open (focus the composer / tap Reply) while Virtuoso is
    // still in its initial settle window. Silently updating the prev refs
    // and bailing would swallow the false→true keyboard transition and the
    // composer-grew transition, so no re-pin ever fires and the latest
    // message stays clipped behind the composer. We rely on the
    // `virtualHandleRef.current` null check below to skip work safely until
    // the list has mounted.
    
    const handle = virtualHandleRef.current;
    if (!handle) return;
    // Initial-mount quiet window: let Virtuoso's own bottom pin own first
    // paint without ANY parent-driven re-snaps — UNLESS the user has already
    // activated the composer (focus → soft keyboard, or reply/edit pill
    // grew the composer). On Android the keyboard can open within the same
    // 600ms window (e.g. composer auto-focus on entry), and silently
    // updating the prev refs here would swallow the false→true transition,
    // so the latest message would stay clipped behind the composer with no
    // re-pin ever firing.
    const withinMountQuiet = performance.now() - mountedAtRef.current < INITIAL_MOUNT_QUIET_MS;
    const keyboardJustOpened = !prevKeyboardOpenRef.current && isKeyboardOpen;
    const composerJustGrew = composerHeight - prevComposerHeightRef.current > 4;
    if (withinMountQuiet && !keyboardJustOpened && !composerJustGrew) {
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

    // When the user is scrolled UP reading history and the composer grows
    // (multi-line typing, reply pill), the fixed composer covers more of the
    // visible content. The scroll viewport itself doesn't resize (composer is
    // position: fixed and overlays the scroller), so the bottommost visible
    // message slides UNDER the composer. Compensate by shifting scrollTop
    // down by the same delta — the content the user was reading stays put
    // above the composer's new top edge. Don't do this when at/near bottom:
    // the pin-to-bottom branch below already handles that case.
    if (composerGrew && previousComposerHeight > 0) {
      const delta = composerHeight - previousComposerHeight;
      const handleNearBottom = handle.isNearBottom(180);
      if (!handleNearBottom) {
        const viewport = resolveChatScrollViewport(mountBoxRef.current);
        if (viewport) {
          viewport.scrollTop = viewport.scrollTop + delta;
          markChatScrollWrite();
        }
      }
    }




    if (!initialBottomPinned && !composerActivated) return;

    const wasNearBottom = handle.isNearBottom(180);
    const shouldPreserveBottom =
      wasNearBottom ||
      wasNearBottomBeforeLayoutRef.current ||
      (keyboardChanged && handle.isNearBottom(720)) ||
      composerActivated;
    if (!composerGrew && !shouldPreserveBottom) return;
    // The scroll compensation above already keeps the visible content stable
    // for users scrolled up reading history; skip the pin-to-bottom branch in
    // that case so we don't yank them to the latest message.
    if (composerGrew && !wasNearBottom && !wasNearBottomBeforeLayoutRef.current && !keyboardChanged) return;

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
      {messages.length === 0 || virtualReady || hasMountedListRef.current ? (
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
          initialTargetMessageId={initialTargetMessageId}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
}
