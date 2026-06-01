import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  debugAttachScrollerWatcher,
  debugLogAnchor,
  debugLogBottomPin,
  debugLogDuplicate,
  debugLogFirstItemIndex,
  debugLogMeasure,
  debugLogStartReached,
  debugTrackRender,
  isChatVirtDebugEnabled,
  classifyChatRow,
  type ChatRowType,
} from "./chatVirtDebug";
import {
  getCachedRowHeight,
  setCachedRowHeight,
} from "./chatRowHeightCache";
import {
  installChatScrollIntentTracking,
  isViewportUserActive,
} from "@/lib/chatScrollIntent";
import { BasicChatMessageList } from "./BasicChatMessageList";
import { useChatVirtualizationEnabled } from "@/hooks/useChatVirtualizationEnabled";
import { isChatJumpActive } from "@/lib/chatJumpActive";
import { isRecentChatScrollWrite, markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";

/**
 * Hoisted Header/Footer components. Inline declarations inside `useMemo`
 * (with topPadding/bottomPadding deps) generated a new component identity
 * every time padding changed, forcing Virtuoso to remount the footer and
 * apply a paddingTop correction — visible as an upward jolt. Reading the
 * padding values from Virtuoso's `context` keeps the function identity
 * stable across renders.
 */
type ChatVirtuosoContext = { topPadding: number; bottomPadding: number | string };
const ChatVirtuosoHeader = ({ context }: { context?: ChatVirtuosoContext }) => (
  <div style={{ height: context?.topPadding ?? 0, overflowAnchor: "none" }} />
);
const ChatVirtuosoFooter = ({ context }: { context?: ChatVirtuosoContext }) => (
  <div style={{ height: context?.bottomPadding ?? 0 }} />
);


/**
 * Virtualised chat message list.
 *
 * Drop-in replacement for the legacy mapped list used by chat pages, gated
 * behind the `ff:chat-virtualization` feature flag. Designed so the parent's
 * pagination, message data, and per-row JSX stay unchanged.
 *
 * Behaviour parity:
 *  - Mounts pinned to latest message (no upward jolt on cold open).
 *  - Upward infinite pagination via `startReached` (replaces the
 *    IntersectionObserver in `useChatOlderMessagesAnchor`).
 *  - Exact scroll anchor on prepend via virtuoso's `firstItemIndex` shift.
 *  - Auto-scroll to bottom only when the user is already at bottom; while
 *    reading history the parent shows its existing "new message" indicator.
 *  - Stable keys (`computeItemKey`) so reaction/edit updates don't churn
 *    neighbouring rows.
 *  - 1200px upward overscan matches existing prefetch margin.
 *
 * The component intentionally takes a `renderItem(message, index, arr)`
 * function so each chat page can keep its bespoke per-row JSX (date
 * separators, highlight ring, ChatMessage props) without duplication.
 */

export interface VirtualizedChatMessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  isAtBottom: () => boolean;
  /**
   * True when the scroller is within `thresholdPx` of the bottom. Used by
   * chat pages to decide whether composer/keyboard reflow should re-pin to
   * the latest message. Returns true if the scroller has not mounted yet
   * (matches the "default to pinning" semantics of the legacy helper).
   */
  isNearBottom: (thresholdPx: number) => boolean;
}

interface Props<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderItem: (message: TMessage, index: number, arr: TMessage[]) => React.ReactNode;
  /** Padding above the first message (e.g. for the "load older" spinner). */
  topPadding?: number;
  /** Padding below the last message (typically composer + safe-area). */
  bottomPadding?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** Notified on at-bottom transitions so the parent can drive its FAB. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Exposes Virtuoso's real scroll element to legacy chat scroll hooks. */
  scrollerRef?: (element: HTMLElement | Window | null) => void;
  /** Parent's initial-pin state; prevents reveal before legacy pin completed. */
  initialBottomPinned?: boolean;
  /** Current user id, used only for row-height estimates (own messages have no author label). */
  currentUserId?: string | null;
}

type EstimableChatMessage = {
  author_id?: string | null;
  text?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  created_at?: string | null;
  reply_to?: unknown;
  reply_to_id?: string | null;
  reactions?: unknown[] | null;
  is_system_message?: boolean | null;
};

function isAndroidNativeWebView() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const cap = (window as any).Capacitor;
  try {
    if (cap?.isNativePlatform?.() && cap?.getPlatform?.() === "android") return true;
  } catch { /* ignore */ }
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua) && (/(; wv\)|\bwv\b)/i.test(ua) || /IgniteClubHQ-Android/i.test(ua));
}

function getMessageDay(value?: string | null) {
  return value ? new Date(value).toDateString() : "";
}

// Approx characters that fit on one line of a chat bubble at the current
// viewport. Bubble max-width ≈ 75% of viewport, ~7.2px per char at 14px body
// font. Memoised lazily so we don't read window on every estimate call.
let __cachedCharsPerLine = 0;
let __cachedViewportWidth = 0;
function getCharsPerLine() {
  const w = typeof window !== "undefined" ? window.innerWidth : 411;
  if (w !== __cachedViewportWidth) {
    __cachedViewportWidth = w;
    // Bubble inner width ≈ (viewport - 32px outer padding) * 0.75 - 24px bubble padding.
    const bubbleInner = Math.max(140, (w - 32) * 0.75 - 24);
    __cachedCharsPerLine = Math.max(16, Math.floor(bubbleInner / 7.2));
  }
  return __cachedCharsPerLine;
}

// Per-token-type reserved heights for inline link/preview cards. Real cards
// vary 96–220px; over-reserving is safer than under (Virtuoso shrinks
// paddingTop on under-estimates which reads as an upward jolt mid-scroll).
// Per-token-type reserved heights. Tuned from production drift telemetry
// (see /admin/chat-virt-debug). Conservative: under-reserving causes the
// upward "jolt" symptom; over-reserving leaves harmless extra padding.
// Note: under-reserving causes upward jolts (Virtuoso grows paddingTop after
// measure, pushing the viewport down); over-reserving causes downward jolts
// (paddingTop shrinks, viewport slides up). Production telemetry showed the
// previous defaults were systematically over-reserving by 90-130px on URL
// previews and 30-40px on text bubbles, which read as a continuous upward
// drift during fast upward flicks.
const PREVIEW_HEIGHT_BY_TOKEN: Record<string, number> = {
  event: 200,
  poll: 180,
  board: 160,
  vault: 96,
  vaultfolder: 96,
  vaultroot: 96,
  gallery: 180,
  galleryprompt: 76,
  // Generic URL previews. Previously bumped to 160 after a p95 outlier
  // (+570px on a single rich article card), but follow-up telemetry showed
  // typical cards measure ~80-100px, leaving every URL row over-reserved
  // by 43-86px — the dominant downward jolt source on upward flicks.
  // 130 over-corrected — round-2 telemetry showed every URL row over by
  // ~60 (233→174, 214→154, 290→214, 292→174). 75 centers the compact
  // card (favicon strip + title + 1-2 line description); rich hero cards
  // remain a rare upward outlier the cache absorbs on revisit.
  url: 75,
};

/**
 * Compute a compact signature of every message field that affects rendered
 * row height. Used as a versioning key on the row-height cache so that an
 * edit, a reaction add/remove, a link-preview hydration, or any other
 * layout-affecting mutation immediately invalidates the cached measurement
 * — even for rows that were unmounted (off-screen) when the change landed.
 *
 * Cheap to compute (called per-row on every estimator invocation): no JSON
 * serialisation of large objects, just primitive concatenation.
 */
function chatRowSignature(message: unknown): string {
  const m = (message ?? {}) as {
    text?: string | null;
    image_url?: string | null;
    imageUrl?: string | null;
    edited_at?: string | null;
    is_edited?: boolean | null;
    reply_to?: { id?: string } | null;
    reply_to_id?: string | null;
    reactions?: Array<{ emoji?: string; user_id?: string } | unknown> | null;
    link_preview?: unknown;
    link_previews?: unknown;
    preview?: unknown;
  };
  const text = (m.text ?? "");
  const img = m.image_url ?? m.imageUrl ?? "";
  const edited = m.edited_at ?? (m.is_edited ? "1" : "");
  const replyId =
    (m.reply_to && typeof m.reply_to === "object" && (m.reply_to as { id?: string }).id) ||
    m.reply_to_id ||
    "";
  // Reactions: count + total emoji-string length is a stable fingerprint
  // of the reaction set without serialising user ids.
  let rxCount = 0;
  let rxEmojiLen = 0;
  if (Array.isArray(m.reactions)) {
    rxCount = m.reactions.length;
    for (const r of m.reactions) {
      const e = (r as { emoji?: string })?.emoji;
      if (typeof e === "string") rxEmojiLen += e.length;
    }
  }
  // Link-preview hydration: just the presence/shape, not the payload.
  const hasPreview =
    (m.link_preview ? 1 : 0) | (m.link_previews ? 2 : 0) | (m.preview ? 4 : 0);
  return `${text.length}:${text.slice(0, 64)}|${img.length}|${edited}|${replyId}|${rxCount}.${rxEmojiLen}|${hasPreview}`;
}

function estimateChatRowHeight<TMessage extends { id: string }>(
  message: TMessage,
  index: number,
  messages: TMessage[],
  currentUserId?: string | null,
) {
  // Prefer the real measured height from the previous mount of this row.
  // Eliminates Virtuoso's post-measure paddingTop correction on revisits.
  // Pass a content signature so an edit / reaction change / preview hydrate
  // that happened while this row was unmounted invalidates the stale value.
  const cached = getCachedRowHeight(message.id, chatRowSignature(message));
  if (cached !== undefined) return cached;
  const msg = message as TMessage & {
    author_name?: string | null;
    edited_at?: string | null;
    is_edited?: boolean | null;
  } & EstimableChatMessage;
  const prev = messages[index - 1] as (TMessage & EstimableChatMessage) | undefined;
  let height = 16; // row wrapper top padding (pt-4)

  if (msg.created_at) {
    const currentDay = getMessageDay(msg.created_at);
    const previousDay = getMessageDay(prev?.created_at);
    // ChatDateSeparator is `my-4` (32px) plus a small pill (~24px).
    // Under-estimating separator rows is a common cause of Virtuoso applying
    // a late upward correction when an upward fling settles.
    if (!previousDay || previousDay !== currentDay) height += 56;
  }

  const text = (msg.text || "").trim();
  const hasImage = !!(msg.image_url || msg.imageUrl);
  const hasReply = !!(msg.reply_to || msg.reply_to_id);
  const reactions = Array.isArray(msg.reactions) ? msg.reactions.length : 0;

  const systemGalleryCardMatch = msg.is_system_message
    ? text.match(/^\s*\[(gallery|galleryprompt):[0-9a-f-]{36}\]\s*$/i)
    : null;
  if (systemGalleryCardMatch) {
    const kind = systemGalleryCardMatch[1]?.toLowerCase();
    // Gallery prompt system rows render as a compact card, not as the normal
    // grey system pill. U8 Blue's first page contains one near the top of the
    // initial data set; under-estimating it as a 52px system pill makes
    // Virtuoso correct the bottom anchor after first paint.
    return height + (kind === "galleryprompt" ? 76 : 220);
  }

  if (msg.is_system_message) return Math.max(52, height + 36);

  // Author / header line. ChatMessage hides the author name when the
  // previous visible row is from the SAME author within a short window
  // (consecutive bubbles are grouped). Mirror that here — counting an
  // always-present 24px header was the dominant -34px over-estimate seen
  // in production telemetry.
  const isOwnMessage = !!currentUserId && msg.author_id === currentUserId;
  const sameAuthorAsPrev =
    !!prev &&
    !prev.is_system_message &&
    !!msg.author_id &&
    prev.author_id === msg.author_id &&
    // Same calendar day — date separator above breaks the group.
    getMessageDay(msg.created_at) === getMessageDay(prev.created_at);
  const showAuthorHeader = !isOwnMessage && !sameAuthorAsPrev;
  if (showAuthorHeader) {
    const authorChars = (msg.author_name ?? "").length;
    // Avatar + name + spacing in ChatMessage measures ~40px (or ~56 when the
    // name wraps). Telemetry showed the previous 22/44 values produced a
    // consistent +16px under-reservation on non-grouped rows.
    height += authorChars > 24 ? 56 : 40;
  }

  // ReplyIndicator: 36 under-reserved across the board (Δ +34 to +80
  // dominant on text+reply rows). Quote header + sender label + 1-2 line
  // quoted text typically measures ~56px. Bump to 56 — outliers with very
  // long wrapped quotes still take small upward corrections, which is
  // preferable to systematic downward drift.
  if (hasReply) height += 56;
  // Image bubble: 245 still slightly over on the dominant case (Δ -25 to
  // -48 across captionless image rows). Drop to 225 — captioned/portrait
  // images remain a +60 to +77 upward outlier the cache absorbs on revisit.
  if (hasImage) height += 225;

  // Strip mention pills and embed tokens before counting visible text length.
  const visibleText = text
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt):[^\]]+\]/gi, "")
    .trim();

  if (visibleText) {
    const charsPerLine = getCharsPerLine();
    const explicitLines = visibleText.split(/\n/);
    let lineCount = 0;
    for (const line of explicitLines) {
      lineCount += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    // ~19px per visual line — telemetry showed 20 was a touch hot on long
    // messages (caused -44/-52/-76 over-estimates).
    height += Math.min(12, lineCount) * 19;
  } else if (!hasImage) {
    height += 32;
  }

  // Inline preview cards. Match each token type separately so per-type
  // reserved heights are accurate.
  const tokenMatches = text.matchAll(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt):[^\]]+\]/gi);
  let previewHeight = 0;
  let previewCount = 0;
  for (const match of tokenMatches) {
    if (previewCount >= 3) break;
    const kind = (match[1] || "").toLowerCase();
    previewHeight += PREVIEW_HEIGHT_BY_TOKEN[kind] ?? 96;
    previewCount += 1;
  }
  // Generic URL previews (only count once per message — we render at most one).
  if (previewCount < 3 && /https?:\/\/|www\./i.test(text)) {
    previewHeight += PREVIEW_HEIGHT_BY_TOKEN.url;
  }
  height += previewHeight;

  // Reactions row wraps every ~4 chips on a phone-width bubble.
  if (reactions) height += Math.ceil(reactions / 4) * 28;

  // Timestamp row + bubble vertical padding. Round-2 telemetry showed the
  // +30 chrome bump was wrong direction — every plain text bubble came in
  // systematically OVER by ~30 (105→74, 124→94, 143→114, 162→134, 181→154,
  // 199→170). Revert to 0; per-line height already covers the timestamp row
  // bottom padding.
  // (no chrome added here)
  if (msg.edited_at || msg.is_edited) height += 4;

  // Allow taller rows now that long messages and stacked previews are real.
  return Math.max(56, Math.min(960, height));
}

const ChatVirtuosoScroller = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, scrollerRef) => (
    <div
      {...props}
      ref={scrollerRef}
      data-chat-scroll-lock="true"
      data-chat-virtualized="true"
      className={`${(props as any).className ?? ""} scrollbar-hide`}
      style={{
        ...style,
        overscrollBehaviorY: "contain",
        // Promote the scroller to its own compositor layer so momentum
        // scrolling on iOS/Android WebViews doesn't repaint sibling DOM each
        // frame. Without this, fast upward flicks repaint the chat header
        // and composer alongside the scroller, which reads as jitter.
        transform: "translateZ(0)",
        willChange: "scroll-position",
        // iOS WebKit momentum scrolling. Harmless on Android/Chromium.
        WebkitOverflowScrolling: "touch",
      } as React.CSSProperties}
    />
  ),
);
ChatVirtuosoScroller.displayName = "ChatVirtuosoScroller";

// Custom Item wrapper that applies CSS containment to each virtualised row.
// This is the single biggest win for fast upward scrolls on native: when a
// row mounts it can no longer invalidate ancestor layout/paint, so the
// 1400px upward overscan (which mounts many rows during a fast flick) stops
// causing main-thread layout thrash.
const ChatVirtuosoItem = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, itemRef) => (
    <div
      {...props}
      ref={itemRef}
      data-chat-virtuoso-item="true"
      style={{
        ...style,
        contain: "content",
      }}
    />
  ),
);
ChatVirtuosoItem.displayName = "ChatVirtuosoItem";

/**
 * Wraps a virtualised row to record render churn (key stability signal) and
 * the first-paint measured height vs the static estimate. Only mounted when
 * `isChatVirtDebugEnabled()` is true, so it has zero cost in production.
 */
function DebugRowProbe({
  messageId,
  estimated,
  rowType,
  children,
}: {
  messageId: string;
  estimated: number | undefined;
  rowType: ChatRowType;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  debugTrackRender(messageId);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    debugLogMeasure(messageId, estimated, el.offsetHeight, rowType);
  }, [messageId, estimated, rowType]);
  return (
    <div ref={ref} data-debug-probe={messageId} data-row-type={rowType}>
      {children}
    </div>
  );
}

/**
 * Always-mounted measurement wrapper. Writes the row's real `offsetHeight`
 * into the module-level cache (`chatRowHeightCache`) so `estimateChatRowHeight`
 * can return the exact previous value the next time this row mounts. Uses a
 * ResizeObserver so reactions / edits / late-loading link previews update the
 * cached value as the row's true height changes.
 *
 * Identity-stable component (declared at module scope) — safe to use inside a
 * stable `itemContent` callback.
 */
function CachedMeasureRow({
  messageId,
  signature,
  children,
}: {
  messageId: string;
  signature: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest signature in a ref so the ResizeObserver callback always
  // writes the freshest version alongside the measured height (without
  // re-subscribing the observer on every signature change).
  const sigRef = useRef(signature);
  sigRef.current = signature;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = () => {
      const h = el.offsetHeight;
      if (h > 0) setCachedRowHeight(messageId, h, sigRef.current);
    };
    write();
    // Android WebView crash fix: a fast fling through chat history was creating
    // hundreds of per-row ResizeObservers in seconds (546 total in the field
    // snapshot), which correlated with 14–18s compositor stalls / app kills.
    // Virtuoso already observes row size; on Android we only capture the mount
    // height and skip our extra live observer. Edits/reactions still recapture
    // through the signature layout effect below.
    if (isAndroidNativeWebView()) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [messageId]);
  // Re-write the cached height whenever the signature changes (edit, reaction,
  // preview hydrate) — content height may shift before the ResizeObserver
  // fires, so capture it eagerly.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0) setCachedRowHeight(messageId, h, signature);
  }, [messageId, signature]);
  return (
    <div ref={ref} data-row-id={messageId}>
      {children}
    </div>
  );
}

/**
 * Memoised wrapper for one virtualised row. Virtuoso re-invokes the parent's
 * `itemContent` for every visible row each time the `data` array reference
 * changes (e.g. on every prepend page). Without memoisation, that means the
 * parent's `renderItem` closure is invoked — and each `ChatMessage` rebuilt
 * — for every visible row on every prepend, producing the "21 renders / 1.5s"
 * key churn observed in production telemetry.
 *
 * This adapter takes ONLY the message reference as a memo key; the real
 * `renderItem`, the index map, and the messages array are read from refs so
 * an updated parent closure does not invalidate every row. The result: a row
 * only re-renders when its OWN message reference changes (edit, reaction,
 * read-receipt update — all already produce a fresh message object via the
 * upstream cache).
 */
type ChatRowAdapterProps = {
  message: { id: string };
  renderItemRef: React.MutableRefObject<
    (message: any, index: number, arr: any[]) => React.ReactNode
  >;
  uniqueMessagesRef: React.MutableRefObject<any[]>;
  indexByIdRef: React.MutableRefObject<Map<string, number>>;
  currentUserIdRef: React.MutableRefObject<string | null | undefined>;
};

const ChatRowAdapter = memo(
  function ChatRowAdapter({
    message,
    renderItemRef,
    uniqueMessagesRef,
    indexByIdRef,
    currentUserIdRef,
  }: ChatRowAdapterProps) {
    const idx = indexByIdRef.current.get(message.id);
    if (idx === undefined) return null;
    const child = renderItemRef.current(message, idx, uniqueMessagesRef.current);
    const signature = chatRowSignature(message);
    const debug = isChatVirtDebugEnabled();
    const estimated =
      debug && idx >= 0
        ? estimateChatRowHeight(message as any, idx, uniqueMessagesRef.current, currentUserIdRef.current)
        : undefined;
    const measured = (
      <CachedMeasureRow messageId={message.id} signature={signature}>{child}</CachedMeasureRow>
    );
    if (estimated === undefined) return measured;
    const rowType = classifyChatRow(message as Parameters<typeof classifyChatRow>[0]);
    return (
      <DebugRowProbe messageId={message.id} estimated={estimated} rowType={rowType}>
        {measured}
      </DebugRowProbe>
    );
  },
  // Skip re-render unless THIS row's message reference changed. The ref props
  // are stable for the lifetime of the parent component, so they're never the
  // cause of a re-render.
  (prev, next) => prev.message === next.message,
);

/**
 * Lightweight skeleton overlay shown briefly while a deep-link / jump-to-
 * message is hydrating. Uses semantic tokens so it follows the active theme,
 * and `pointer-events-none` so the user can still scroll/tap underneath if
 * they want to abort.
 */
function JumpHydrationSkeleton() {
  const rows = [82, 64, 96, 72, 88, 60, 78];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-3 px-4 pb-6 animate-in fade-in duration-150"
      style={{
        // NOTE: do NOT add backdrop-filter here. On Android WebView, a
        // backdrop blur layered over a virtualised scroller forces the
        // compositor to re-rasterise on every scroll frame and causes
        // multi-second freezes. The gradient alone is sufficient.
        background:
          "linear-gradient(to bottom, hsl(var(--background) / 0.96), hsl(var(--background)))",
      }}
    >
      {rows.map((width, i) => (
        <div
          key={i}
          className="flex"
          style={{ justifyContent: i % 2 === 0 ? "flex-start" : "flex-end" }}
        >
          <div
            className="h-10 rounded-2xl bg-muted animate-pulse"
            style={{ width: `${width}%`, maxWidth: "75%" }}
          />
        </div>
      ))}
    </div>
  );
}

function VirtualizedChatMessageListInner<TMessage extends { id: string }>(
  {
    messages,
    hasOlder,
    isLoadingOlder,
    onLoadOlder,
    renderItem,
    topPadding = 16,
    bottomPadding = 16,
    className,
    style,
    onAtBottomChange,
    scrollerRef,
    initialBottomPinned = true,
    currentUserId,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const atBottomRef = useRef(true);
  const bottomPinReadyRef = useRef(false);
  const pinnedRevisionRef = useRef<number | null>(null);
  // Tracks which revision currently has an in-flight pin sequence
  // (immediate → raf1 → raf2 → stabilisation). Without this, the
  // depless useLayoutEffect below re-fires `jump("immediate")` on
  // every parent re-render that occurs during the 320ms stabilisation
  // window (Virtuoso paddingTop measurements cause many such renders),
  // flooding telemetry and re-yanking scrollTop.
  const pinAttemptRevisionRef = useRef<number | null>(null);
  const [initialRevealReady, setInitialRevealReady] = useState(false);
  // Timestamp of when the initial bottom-pin completed. Used to enforce a
  // "trust window" before any upward pagination fires, so the very first
  // upward gesture never triggers a prepend that visually teleports the
  // viewport to messages the user hasn't scrolled through yet (the
  // "scroll up, stop, then jump higher" symptom on cold open).
  const bottomPinReadyAtRef = useRef(0);
  const userHasScrolledAfterPinRef = useRef(false);
  // Fresh-login / cold-open safety net: cached messages can mount first, then
  // the fresh query appends the real latest row a moment later. Track the
  // opening window so those first data swaps keep landing on the latest row,
  // unless the user has deliberately started reading history.
  const openPinStartedAtRef = useRef<number | null>(null);
  const openPinLastMessageIdRef = useRef<string | null>(null);
  // Tracks the messages.length seen by the cold-open re-pin guard so it can
  // detect cached→fresh page swaps where lastMessageId is unchanged but
  // older rows get extended/replaced (which still shifts the bottom row).
  const openPinMessagesLengthRef = useRef<number>(-1);
  // Trust window in ms: until this elapses past the bottom-pin completion,
  // `startReached` is suppressed. After expiry, normal upward prefetch
  // resumes.
  const PREPEND_TRUST_WINDOW_MS = 800;
  const messagesLengthRef = useRef(messages.length);
  const hasOlderRef = useRef(hasOlder);
  const isLoadingOlderRef = useRef(isLoadingOlder);
  const onLoadOlderRef = useRef(onLoadOlder);
  const startReachedRetryTimerRef = useRef<number | null>(null);
  hasOlderRef.current = hasOlder;
  isLoadingOlderRef.current = isLoadingOlder;
  onLoadOlderRef.current = onLoadOlder;
  // Synchronous in-flight guard for `startReached`. The parent's
  // `isLoadingOlder` state flips via setState, so two `startReached` events
  // fired in the same frame on a fast upward flick both see `false` and
  // double-fetch — the prepended page is then merged twice into the data
  // array, producing duplicate IDs and "ghost" rows in Virtuoso.
  const loadingOlderInFlightRef = useRef(false);
  // Once messages.length grows, the prepend has landed — release the guard.
  useEffect(() => {
    if (messages.length > messagesLengthRef.current) {
      loadingOlderInFlightRef.current = false;
    }
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Also release the guard whenever the parent's `isLoadingOlder` flag
  // transitions back to `false`. The length-grew effect above ONLY fires on
  // a successful prepend; if an older-page fetch errors, returns zero rows,
  // or hits the 25s abort timeout, `messages.length` never grows and the
  // synchronous guard would otherwise stay `true` forever — silently blocking
  // every subsequent `startReached` with "in-flight-guard" and making the
  // chat appear to stop scrolling at whatever boundary it last reached.
  // This was the root cause of "team admins/coaches can only scroll back to
  // <date>" — one transient older-page failure permanently disabled upward
  // pagination for the rest of the session.
  const prevIsLoadingOlderRef = useRef(isLoadingOlder);
  useEffect(() => {
    if (prevIsLoadingOlderRef.current && !isLoadingOlder) {
      loadingOlderInFlightRef.current = false;
    }
    prevIsLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder]);

  useEffect(() => {
    if (hasOlder) return;
    if (startReachedRetryTimerRef.current !== null) {
      window.clearTimeout(startReachedRetryTimerRef.current);
      startReachedRetryTimerRef.current = null;
    }
  }, [hasOlder]);

  useEffect(() => {
    return () => {
      if (startReachedRetryTimerRef.current !== null) {
        window.clearTimeout(startReachedRetryTimerRef.current);
        startReachedRetryTimerRef.current = null;
      }
    };
  }, []);

  // Virtuoso's anchored-prepend trick: keep `firstItemIndex` tied to the
  // message that was first visible when this data set was established. This
  // is deterministic for a given `messages` array: prepends move the base
  // message to a larger data index, so we subtract that offset; appends do not
  // move it, so the first item index stays unchanged. The previous incremental
  // ref-diff approach could still double-shift under aborted/concurrent renders
  // and produced duplicate rows / shake after fast scrolls.
  const START_INDEX = 1_000_000;
  const newFirstId = messages[0]?.id ?? null;
  const wasEmptyRef = useRef(messages.length === 0);
  const [bottomPinRevision, setBottomPinRevision] = useState(0);
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const anchorRef = useRef<{ baseFirstId: string | null; baseFirstIndex: number }>({
    baseFirstId: newFirstId,
    baseFirstIndex: START_INDEX - messages.length,
  });

  // Pure derivation — no ref mutations during render. Anchor reset (when the
  // baseFirstId is no longer in the data) is moved into a layout effect below
  // so StrictMode / concurrent re-renders cannot double-fire it mid-scroll
  // and snap the viewport while the user is reading history.
  // NOTE: anchor math is computed against the raw `messages` array (not the
  // de-duped one) because the parent's pagination merges land here first; if
  // a duplicate ever slips in we still want the FIRST occurrence (index 0)
  // to be the anchor, which matches `uniqueMessages[0]`.
  const baseFirstId = anchorRef.current.baseFirstId;
  const baseOffset =
    messages.length === 0
      ? 0
      : baseFirstId
      ? messages.findIndex((message) => message.id === baseFirstId)
      : -1;
  const needsAnchorReset = messages.length > 0 && (!baseFirstId || baseOffset === -1);
  const effectiveBaseIndex = needsAnchorReset
    ? START_INDEX - messages.length
    : anchorRef.current.baseFirstIndex;
  const effectiveBaseOffset = needsAnchorReset ? 0 : Math.max(0, baseOffset);
  const firstItemIndex = effectiveBaseIndex - effectiveBaseOffset;
  const firstItemIndexRef = useRef(firstItemIndex);
  firstItemIndexRef.current = firstItemIndex;
  wasEmptyRef.current = messages.length === 0;
  const latestInitialSettleSignatureRef = useRef("");
  latestInitialSettleSignatureRef.current = `${messages.length}:${lastMessageId ?? ""}:${firstItemIndex}:${String(bottomPadding)}`;

  useEffect(() => {
    if (messages.length === 0) {
      anchorRef.current = { baseFirstId: null, baseFirstIndex: START_INDEX };
      return;
    }
    if (needsAnchorReset) {
      const prev = anchorRef.current;
      anchorRef.current = {
        baseFirstId: newFirstId,
        baseFirstIndex: START_INDEX - messages.length,
      };
      // CRITICAL: only re-arm the bottom-pin revision when the user is at /
      // near the bottom (or hasn't pinned yet). Otherwise an in-flight
      // refetch / cache replacement that drops the previous baseline id
      // would teleport a user who is reading history straight back to LAST.
      // We still update the anchor itself so subsequent prepends shift
      // `firstItemIndex` correctly from the new baseline.
      const userIsReadingHistory = bottomPinReadyRef.current && !atBottomRef.current;
      if (!userIsReadingHistory) {
        bottomPinReadyRef.current = false;
        bottomPinReadyAtRef.current = 0;
        userHasScrolledAfterPinRef.current = false;
        openPinStartedAtRef.current = null;
        openPinLastMessageIdRef.current = null;
        openPinMessagesLengthRef.current = -1;
        setBottomPinRevision((revision) => revision + 1);
      }
      debugLogAnchor("reset", {
        previousBaseFirstId: prev.baseFirstId,
        newBaseFirstId: newFirstId,
        messagesLen: messages.length,
        newBaseFirstIndex: START_INDEX - messages.length,
        suppressedRePin: userIsReadingHistory,
      } as Record<string, unknown>);
    }
  }, [needsAnchorReset, newFirstId, messages.length]);

  // Trace firstItemIndex movement (the dominant signal for "the viewport
  // jumped under me"). Cheap when debug is off.
  useEffect(() => {
    debugLogFirstItemIndex(firstItemIndex, messages.length);
  }, [firstItemIndex, messages.length]);

  // Tracks whether this mount has ever observed a non-empty messages array.
  // Used to distinguish "empty thread (genuinely no messages)" from "first
  // open after fresh login where the cache is cold and messages haven't
  // streamed in yet". In the latter case, revealing the empty viewport at
  // opacity 1 lets the user see the chat surface unpinned; when messages
  // then arrive, the snap-to-LAST is visible as a downward jolt.
  const hasEverHadMessagesRef = useRef(false);
  if (messages.length > 0) hasEverHadMessagesRef.current = true;

  // Initial bottom pin happens while the wrapper is invisible. Reveal is held
  // until the actual scroll metrics are quiet, not just until a fixed timeout,
  // so first paint cannot show Virtuoso correcting an interim bottom anchor.
  useLayoutEffect(() => {
    const last = messages.length - 1;
    if (last < 0) {
      bottomPinReadyRef.current = false;
      pinnedRevisionRef.current = null;
      pinAttemptRevisionRef.current = null;
      // Empty thread on first-ever mount (cold cache after fresh login):
      // hold the reveal back briefly so that if messages stream in within
      // the grace window we go straight into the pin sequence without
      // ever painting an unpinned empty viewport. If the grace expires
      // with still no messages, reveal so the empty-state is visible.
      // Deep-link jump-to-message is unaffected: that path runs through
      // the non-empty branch (messages exist by the time the jump fires)
      // and is gated on `isChatJumpActive()` below.
      if (!initialBottomPinned || hasEverHadMessagesRef.current) {
        setInitialRevealReady(true);
        return;
      }
      const graceTimer = window.setTimeout(() => setInitialRevealReady(true), 700);
      return () => window.clearTimeout(graceTimer);
    }
    if (!initialBottomPinned) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      pinAttemptRevisionRef.current = null;
      setInitialRevealReady(true);
      return;
    }
    if (bottomPinReadyRef.current && pinnedRevisionRef.current === bottomPinRevision) return;
    if (isChatJumpActive()) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      setInitialRevealReady(true);
      return;
    }
    // Skip if a pin sequence for this revision is already in flight — a
    // re-render mid-stabilisation must not retrigger the synchronous
    // `jump("immediate")` below.
    if (pinAttemptRevisionRef.current === bottomPinRevision) return;
    pinAttemptRevisionRef.current = bottomPinRevision;
    setInitialRevealReady(false);
    const jump = (phase: string) => {
      // Defensive guard: if the user has already scrolled away from the
      // bottom by the time a deferred jump fires (e.g. a refetch landed and
      // bumped the revision, then the user flicked up before raf2/200ms
      // expired), abort the jump rather than yanking them back.
      if (bottomPinReadyRef.current && !atBottomRef.current && phase !== "immediate") {
        debugLogBottomPin(bottomPinRevision, `${phase}-skipped-not-at-bottom`);
        return;
      }
      if (isChatJumpActive()) {
        debugLogBottomPin(bottomPinRevision, `${phase}-skipped-jump-active`);
        return;
      }
      debugLogBottomPin(bottomPinRevision, phase);
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    };
    jump("immediate");
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: number | null = null;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let cancelled = false;
    let disposedAfterReveal = false;
    let lastMetrics = "";
    // Hard deadline for the reveal. On Android, late-hydrating images / link
    // previews / reactions can keep `scrollHeight` ticking for far longer
    // than the 320 ms idle window, which previously left the wrapper at
    // opacity 0 indefinitely AND ran a per-frame rAF the entire time —
    // visible to the user as a frozen, blank chat. After this deadline we
    // reveal regardless and let any remaining reflows happen in plain sight.
    const REVEAL_DEADLINE_MS = 3000;
    const REVEAL_IDLE_MS = 520;
    let visualSettleCleanup: (() => void) | null = null;
    const doReveal = (reason: string) => {
      if (cancelled) return;
      const el = scrollerElRef.current;
      cancelled = true;
      if (revealTimer !== null) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      // Final belt-and-braces re-anchor the frame before we reveal, so any
      // last paddingTop adjustment from overscan-row measurement doesn't
      // visually shift the bottom row at the moment opacity flips to 1.
      if (!isChatJumpActive()) {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
      }
      if (!bottomPinReadyRef.current) bottomPinReadyAtRef.current = performance.now();
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      userHasScrolledAfterPinRef.current = false;
      debugLogBottomPin(bottomPinRevision, `reveal-${reason}`);
      visualSettleCleanup?.();
      visualSettleCleanup = waitForChatVisualContentSettle(el, { quietMs: 520, maxMs: 2400 }, () => {
        if (disposedAfterReveal) return;
        if (isChatJumpActive()) {
          requestAnimationFrame(() => setInitialRevealReady(true));
          return;
        }
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
          setInitialRevealReady(true);
        });
      });
    };
    const armRevealWhenStable = () => {
      const el = scrollerElRef.current;
      if (!el || cancelled) return;
      if (!isChatJumpActive()) {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
      }
      const metrics = `${latestInitialSettleSignatureRef.current}:${Math.round(el.scrollTop)}:${Math.round(el.scrollHeight)}:${Math.round(el.clientHeight)}`;
      if (metrics !== lastMetrics) {
        lastMetrics = metrics;
        if (revealTimer !== null) clearTimeout(revealTimer);
        revealTimer = setTimeout(() => doReveal("idle"), REVEAL_IDLE_MS);
      }
      frame = null;
    };
    const scheduleStableCheck = () => {
      if (cancelled || frame !== null) return;
      frame = requestAnimationFrame(armRevealWhenStable);
    };
    const attachStabilityWatchers = () => {
      const el = scrollerElRef.current;
      if (!el) return;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleStableCheck);
        resizeObserver.observe(el);
        const inner = el.firstElementChild;
        if (inner instanceof HTMLElement) resizeObserver.observe(inner);
      }
      mutationObserver = new MutationObserver(scheduleStableCheck);
      mutationObserver.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
      deadlineTimer = window.setTimeout(() => doReveal("deadline"), REVEAL_DEADLINE_MS);
      scheduleStableCheck();
    };
    let r2: number | null = null;
    const r1 = requestAnimationFrame(() => {
      if (cancelled) return;
      jump("raf1");
      r2 = requestAnimationFrame(() => {
        if (cancelled) return;
        jump("raf2");
        attachStabilityWatchers();
      });
    });
    return () => {
      disposedAfterReveal = true;
      cancelled = true;
      cancelAnimationFrame(r1);
      if (r2 !== null) cancelAnimationFrame(r2);
      if (revealTimer !== null) clearTimeout(revealTimer);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      if (frame !== null) cancelAnimationFrame(frame);
      visualSettleCleanup?.();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
    // Intentionally narrow deps: this effect must NOT re-run on every
    // parent render (Virtuoso paddingTop measurements cause many during
    // the stabilisation window — re-running cancels in-flight rAFs and
    // floods telemetry with redundant `jump("immediate")` calls). It only
    // needs to fire when a new pin revision is requested or when the list
    // transitions between empty / non-empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomPinRevision, messages.length === 0, initialBottomPinned]);

  const handleAtBottomChange = useCallback(
    (atBottom: boolean) => {
      atBottomRef.current = atBottom;
      onAtBottomChange?.(atBottom);
    },
    [onAtBottomChange],
  );

  const handleStartReached = useCallback(() => {
    if (!bottomPinReadyRef.current) {
      debugLogStartReached(false, "bottom-pin-not-ready");
      return;
    }
    const userInitiatedTopReach =
      userHasScrolledAfterPinRef.current || isViewportUserActive(scrollerElRef.current);
    // Trust window: suppress the very first upward fetch right after the
    // initial bottom pin so a cold-open scroll-up cannot trigger a prepend
    // that visually teleports the viewport to older messages the user
    // hasn't scrolled through yet.
    const sincePin = performance.now() - bottomPinReadyAtRef.current;
    if (sincePin < PREPEND_TRUST_WINDOW_MS) {
      debugLogStartReached(false, "trust-window-deferred");
      if (userInitiatedTopReach && startReachedRetryTimerRef.current === null) {
        startReachedRetryTimerRef.current = window.setTimeout(() => {
          startReachedRetryTimerRef.current = null;
          if (!userHasScrolledAfterPinRef.current && !isViewportUserActive(scrollerElRef.current)) return;
          if (!bottomPinReadyRef.current || !hasOlderRef.current || isLoadingOlderRef.current || loadingOlderInFlightRef.current) return;
          loadingOlderInFlightRef.current = true;
          debugLogStartReached(true, "deferred-fetch");
          onLoadOlderRef.current();
        }, Math.max(0, PREPEND_TRUST_WINDOW_MS - sincePin));
      }
      return;
    }
    if (!userInitiatedTopReach) {
      debugLogStartReached(false, "no-user-scroll");
      return;
    }
    if (!hasOlder) {
      debugLogStartReached(false, "no-older");
      return;
    }
    if (isLoadingOlder) {
      debugLogStartReached(false, "already-loading");
      return;
    }
    if (loadingOlderInFlightRef.current) {
      debugLogStartReached(false, "in-flight-guard");
      return;
    }
    loadingOlderInFlightRef.current = true;
    debugLogStartReached(true, "fetch");
    onLoadOlder();
  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  // Belt-and-braces upward pagination trigger. With top overscan,
  // `startReached` can fail to refire after a successful prepend because the
  // rendered range still spans data index 0 — the user scrolls up but
  // Virtuoso never sees a transition INTO the start. `atTopStateChange`
  // fires on every transition into/out of the top edge, so we use it to
  // re-invoke the same load logic. The `handleStartReached` body is fully
  // idempotent (trust window + in-flight guard + `hasOlder` check), so
  // calling it from both paths is safe.
  const handleAtTopStateChange = useCallback(
    (atTop: boolean) => {
      if (!atTop) return;
      handleStartReached();
    },
    [handleStartReached],
  );

  const handleScroll = useCallback(() => {
    if (!bottomPinReadyRef.current) return;
    // Only treat a scroll event as "user scrolled away" when there is a real
    // user gesture behind it. Programmatic `scrollToIndex` snaps (initial
    // pin, stay-pinned re-anchor, follow-output) also dispatch scroll events
    // and would otherwise permanently disable the post-reveal stay-pinned
    // guard — leaving the last message hidden behind the composer after
    // late avatar/image hydration on first cold-cache open.
    if (!isViewportUserActive(scrollerElRef.current)) return;
    userHasScrolledAfterPinRef.current = true;
  }, []);

  // Prepend anchoring is handled entirely by Virtuoso's `firstItemIndex`
  // shift (see anchorRef math above). We deliberately do NOT run a manual
  // scrollTop-restore loop here: writing scrollTop frame-after-frame while
  // Virtuoso is settling its own row-height estimates produces a visible
  // up/down wobble after an upward fling stops ("jitters then lands").

    // Post-reveal "stay pinned" guard. After the initial bottom pin reveals,
  // late-hydrating content (images decoding, link previews mounting, reply
  // quotes inflating, reactions arriving) grows the heights of rows already
  // on screen. Virtuoso's `followOutput` only re-pins when NEW items are
  // appended, not when existing rows resize, so without this the last
  // message visibly drifts downward (or the viewport scrolls up away from
  // it) over the first ~1.2s after open. We watch scrollHeight via a
  // ResizeObserver on the inner content and forcibly re-pin to LAST as long
  // as the user is still at the bottom and hasn't scrolled away.
  useEffect(() => {
    if (!initialRevealReady) return;
    if (!initialBottomPinned) return;
    const viewport = scrollerElRef.current;
    if (!viewport) return;
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (!inner) return;

    let cancelled = false;
    const startedAt = performance.now();
    // Cold post-login opens hydrate more slowly than normal re-opens (auth,
    // profiles, avatars, link previews). Keep the first-open bottom guard
    // alive long enough to absorb that settling without affecting a user who
    // has intentionally scrolled away.
    const STAY_PINNED_MS = 2400;
    let lastScrollHeight = viewport.scrollHeight;
    let lastClientHeight = viewport.clientHeight;

    // SYNCHRONOUS delta compensation. The flicker comes from the gap
    // between a layout-changing paint (image decode / link preview /
    // reaction landing → scrollHeight grows) and the next animation frame
    // where we'd write scrollTop. In that gap the browser paints one frame
    // with content shifted down, then snaps back — visible as a jolt. By
    // adjusting scrollTop synchronously inside the ResizeObserver callback
    // (which fires before the layout-change paint commits) we move the
    // viewport by the exact same delta the inner content grew, so the
    // bottom row stays optically nailed in place.
    const ro = new ResizeObserver(() => {
      if (cancelled) return;
      if (isChatJumpActive()) return;
      if (isViewportUserActive(viewport)) return;
      if (userHasScrolledAfterPinRef.current && !atBottomRef.current) return;
      // Coordinate with sibling writers (openPinWindow timers, parent
      // keyboard-pin). If one of them just wrote scrollTop, skip this pass
      // so we don't apply an opposing micro-correction in the same frame.
      if (isRecentChatScrollWrite(80)) return;


      const sh = viewport.scrollHeight;
      const ch = viewport.clientHeight;
      const delta = sh - lastScrollHeight;
      const viewportDelta = ch - lastClientHeight;
      lastScrollHeight = sh;
      lastClientHeight = ch;
      // Bail on sub-pixel / tiny noise so the RO→scroll→RO feedback loop
      // dies quickly. On Android WebView this is the difference between a
      // ~1.5 s main-thread freeze on first open and a clean reveal.
      if (Math.abs(delta) < 2 && Math.abs(viewportDelta) < 2) return;

      // Re-pin to the true max scroll position for BOTH growth and shrink.
      // Cold-login row estimates can correct in either direction; only
      // handling positive deltas leaves the browser to clamp negative deltas
      // on the next paint, which reads as the down/up jolt the user reported.
      const maxTop = sh - viewport.clientHeight;
      const target = Math.max(0, maxTop);
      if (Math.abs(viewport.scrollTop - target) > 0.5) {
        viewport.scrollTop = target;
        markChatScrollWrite();
      }

      if (performance.now() - startedAt > STAY_PINNED_MS) {
        cancelled = true;
        ro.disconnect();
      }
    });
    ro.observe(viewport);
    ro.observe(inner);

    const stopTimer = window.setTimeout(() => {
      cancelled = true;
      ro.disconnect();
    }, STAY_PINNED_MS + 50);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.clearTimeout(stopTimer);
    };
  }, [initialRevealReady, bottomPinRevision, initialBottomPinned]);


  // Cold-open data refresh guard. On a fresh login we often render cached
  // messages first, then replace/extend them with the network-fresh latest
  // page. `followOutput` only follows when Virtuoso still reports bottom;
  // first-open measurement drift can make that false, leaving the real latest
  // message below the viewport. During the first few seconds only, keep
  // pinning to LAST while there has been no user scroll gesture.
  useLayoutEffect(() => {
    if (!initialRevealReady || !lastMessageId) return;
    if (!initialBottomPinned) return;
    if (openPinStartedAtRef.current === null) openPinStartedAtRef.current = performance.now();

    const previousLastMessageId = openPinLastMessageIdRef.current;
    openPinLastMessageIdRef.current = lastMessageId;

    const OPEN_PIN_WINDOW_MS = 6000;
    const withinOpenWindow = performance.now() - openPinStartedAtRef.current <= OPEN_PIN_WINDOW_MS;
    if (!withinOpenWindow) return;
    // NOTE: do NOT early-return when lastMessageId is unchanged. On first
    // login the cached page often shares its last message id with the
    // network-fresh page, but the fresh page extends/replaces older rows,
    // which shifts the bottom row's pixel position. We still need to
    // re-pin to LAST in that case — relying on lastMessageId alone misses
    // the jolt entirely. Suppress only when the bottom is already nailed
    // AND messages haven't grown since the last pass.
    const messagesLengthChanged = openPinMessagesLengthRef.current !== messages.length;
    openPinMessagesLengthRef.current = messages.length;
    if (
      previousLastMessageId === lastMessageId &&
      !messagesLengthChanged &&
      bottomPinReadyRef.current
    ) return;

    const run = () => {
      const viewport = scrollerElRef.current;
      if (!viewport) return;
      if (isChatJumpActive()) return;
      if (isViewportUserActive(viewport)) return;
      if (userHasScrolledAfterPinRef.current && !atBottomRef.current) return;
      if (isRecentChatScrollWrite(80)) return;
      // Silent scrollTop write rather than `scrollToIndex` — the latter
      // triggers a visible Virtuoso recompute/jump every time it fires,
      // which on first-open stacks into a multi-step flicker as cached
      // messages get replaced/extended by the network refresh.
      const maxTop = viewport.scrollHeight - viewport.clientHeight;
      if (Math.abs(viewport.scrollTop - maxTop) > 1) {
        viewport.scrollTop = maxTop;
        markChatScrollWrite();
      }
    };


    // SYNCHRONOUS first pass — commits in the same paint frame as the
    // cached→fresh message swap, so the browser never paints a frame where
    // the bottom row is partially scrolled off. Without this, Android WebView
    // shows a single-frame "jolt" right after first login as the fresh page
    // replaces the cached one. The rAF + delayed passes below remain as a
    // safety net for late-hydrating row heights (avatars, link previews).
    if (!isChatJumpActive()) run();
    const r = requestAnimationFrame(() => requestAnimationFrame(run));
    // Two follow-up passes are enough to absorb the network-fresh page
    // landing on top of cached messages. The previous 5-timer barrage
    // (160/420/900/1600/2600 ms) caused a visible series of jolts on
    // cold opens.
    const timers = [200, 600].map((delay) => window.setTimeout(run, delay));
    return () => {
      cancelAnimationFrame(r);
      timers.forEach((timer) => window.clearTimeout(timer));
    };

  }, [initialRevealReady, lastMessageId, messages.length, bottomPinRevision, initialBottomPinned]);



  // Only auto-follow new outgoing messages when the user is already at the
  // bottom — never yank a finger reading history.
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? ("auto" as const) : false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior = "auto") => {
        // Defer to the next two animation frames. Send mutations call
        // scrollToBottom synchronously inside `onMutate` — BEFORE React has
        // committed the optimistic message into the cache and BEFORE
        // Virtuoso has rendered the new row. Scrolling to "LAST" right
        // then would land on the previous last message and leave the
        // freshly-sent bubble below the viewport. Waiting one paint lets
        // the new item mount; the second rAF guarantees Virtuoso has
        // measured it so `index: "LAST"` resolves to the correct row.
        //
        // We then schedule additional re-pins across the next ~500ms to
        // absorb composer reflow that lands AFTER send commits: the reply
        // pill clears, edit mode exits, the textarea collapses back to a
        // single line, and the optimistic bubble's own height settles
        // (image decode, link preview hydrate). Each of these shrinks or
        // grows the bottomPadding (which mirrors composer height) AFTER
        // the initial scroll, so without follow-up pins the freshly sent
        // bubble ends up clipped behind the fixed composer.
        const run = () => {
          if (messagesLengthRef.current <= 0) return;
          if (isChatJumpActive()) return;
          if (isViewportUserActive(scrollerElRef.current)) return;
          virtuosoRef.current?.scrollToIndex({
            index: "LAST",
            align: "end",
            behavior,
          });
        };
        requestAnimationFrame(() => requestAnimationFrame(run));
        // Trailing re-pins. Each is independently guarded so an active
        // user gesture (finger drag / momentum) cancels them.
        window.setTimeout(run, 120);
        window.setTimeout(run, 280);
        window.setTimeout(run, 500);
      },

      scrollToIndex: (index, align = "center") => {
        const last = Math.max(0, messagesLengthRef.current - 1);
        const dataIndex = Math.max(0, Math.min(index, last));
        // Virtuoso's `scrollToIndex` operates in the SHIFTED index space
        // when `firstItemIndex` is non-zero (anchored reverse-infinite
        // scroll). Passing a raw data index (e.g. 50) when firstItemIndex
        // is ~999,900 lands the viewport on the oldest loaded row (Virtuoso
        // clamps the out-of-range value to `firstItemIndex`), which is why
        // notification taps and other deep-link jumps stopped routing to
        // the target message. Adding `firstItemIndex` puts the index back
        // into the space Virtuoso reasons about. This matches the official
        // react-virtuoso reverse-chat example.
        virtuosoRef.current?.scrollToIndex({
          index: dataIndex + firstItemIndexRef.current,
          align,
          behavior: "auto",
        });
      },
      isAtBottom: () => atBottomRef.current,
      isNearBottom: (thresholdPx: number) => {
        const el = scrollerElRef.current;
        if (!el) return true;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distance <= Math.max(0, thresholdPx);
      },
    }),
    [],
  );

  // O(1) id → index map AND defensive de-duplication. Pagination races (two
  // `startReached` events firing before React flushes `isLoadingOlder=true`)
  // can land the same older page twice, producing duplicate IDs in the array.
  // Virtuoso would then render a "ghost" duplicate row whose key collides
  // with a sibling. Filter out any second occurrence here so the list the
  // virtualiser sees is always strictly unique.
  const { uniqueMessages, indexById } = useMemo(() => {
    const map = new Map<string, number>();
    const unique: TMessage[] = [];
    const dupCounts = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      const id = messages[i].id;
      if (map.has(id)) {
        dupCounts.set(id, (dupCounts.get(id) ?? 1) + 1);
        continue;
      }
      map.set(id, unique.length);
      unique.push(messages[i]);
    }
    if (dupCounts.size > 0 && isChatVirtDebugEnabled()) {
      for (const [id, count] of dupCounts) debugLogDuplicate(id, count);
    }
    return { uniqueMessages: unique, indexById: map };
  }, [messages]);

  // CRITICAL flicker fix: keep `itemContent` identity stable across messages
  // mutations. If this callback's identity changes when an older page lands,
  // Virtuoso re-invokes it for every visible row, defeating React.memo on
  // ChatMessage and producing a full-row repaint flash mid-scroll. We capture
  // the per-render data into refs and reference them inside a callback that
  // is created ONCE per component instance.
  const renderItemRef = useRef(renderItem);
  const uniqueMessagesRef = useRef(uniqueMessages);
  const indexByIdRef = useRef(indexById);
  const currentUserIdRef = useRef(currentUserId);
  useLayoutEffect(() => {
    renderItemRef.current = renderItem;
    uniqueMessagesRef.current = uniqueMessages;
    indexByIdRef.current = indexById;
    currentUserIdRef.current = currentUserId;
  }, [renderItem, uniqueMessages, indexById, currentUserId]);

  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => (
      <ChatRowAdapter
        message={message}
        renderItemRef={renderItemRef as React.MutableRefObject<
          (m: any, i: number, a: any[]) => React.ReactNode
        >}
        uniqueMessagesRef={uniqueMessagesRef as React.MutableRefObject<any[]>}
        indexByIdRef={indexByIdRef}
        currentUserIdRef={currentUserIdRef}
      />
    ),
    [],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);


  // Force integer measurements. React-Virtuoso's default itemSize uses
  // getBoundingClientRect(), which can oscillate by sub-pixels on fractional
  // DPR phones during momentum scrolling. Each tiny measurement delta causes
  // Virtuoso to mutate paddingTop, which reads as the remaining upward jitter.
  const itemSize = useCallback((el: HTMLElement, field: "offsetHeight" | "offsetWidth") => {
    return field === "offsetHeight" ? el.offsetHeight : el.offsetWidth;
  }, []);

  const components = useMemo(
    () => ({
      Scroller: ChatVirtuosoScroller,
      Item: ChatVirtuosoItem,
      Header: ChatVirtuosoHeader,
      Footer: ChatVirtuosoFooter,
    }),
    [],
  );
  const virtuosoContext = useMemo<ChatVirtuosoContext>(
    () => ({ topPadding: topPadding ?? 0, bottomPadding: bottomPadding ?? 0 }),
    [topPadding, bottomPadding],
  );

  // Attach a debug watcher to Virtuoso's real scroll element so we can flag
  // foreign `scrollTop` writes (legacy chat hooks fighting Virtuoso for
  // ownership of the same scroller — the canonical cause of "rows stacking
  // on top of each other" on fast scroll).
  const wrappedScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      // Track the scroll element for the imperative `isNearBottom` API.
      // Window targets don't apply for the inline Virtuoso scroller, so we
      // only retain HTMLElement instances.
      scrollerElRef.current = element instanceof HTMLElement ? element : null;
      // Track real user gestures (touch / wheel) on the viewport so the
      // post-pin stay-pinned guard can distinguish a user-driven scroll
      // away from programmatic snaps + content-growth driven `atBottom`
      // flips. Without this, the very first programmatic `scrollToIndex`
      // after reveal fires a `scroll` event that we'd mistakenly count as
      // "user scrolled away".
      installChatScrollIntentTracking(scrollerElRef.current);
      debugAttachScrollerWatcher(element);
      scrollerRef?.(element);
    },
    [scrollerRef],
  );

  // Brief skeleton overlay while a deep-link/jump-to-message is hydrating.
  // Driven by window CustomEvents from `jumpToMessageInVirtualizedChat` so
  // every chat surface (Team/Group/Club/Broadcast/ClubAdmin/DM) gets the
  // mask without prop-drilling. Masks the visible re-anchor as deferred row
  // sub-content (link previews, replies, reactions) hydrates after scroll.
  const [isJumpHydrating, setIsJumpHydrating] = useState(false);
  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    const onStart = () => {
      if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
      }
      setIsJumpHydrating(true);
    };
    const onEnd = () => {
      // Slight delay before hiding so the cross-fade reads as intentional
      // rather than a flash if hydration finishes in <100ms.
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => setIsJumpHydrating(false), 120);
    };
    window.addEventListener("chat:jump-hydration-start", onStart);
    window.addEventListener("chat:jump-hydration-end", onEnd);
    return () => {
      window.removeEventListener("chat:jump-hydration-start", onStart);
      window.removeEventListener("chat:jump-hydration-end", onEnd);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        opacity: initialRevealReady ? 1 : 0,
        transition: initialRevealReady ? "opacity 80ms ease-out" : "none",
      }}
    >
    <Virtuoso
      ref={virtuosoRef}
      className={className}
      style={{ height: "100%", ...style, overflowAnchor: "none" }}
      data={uniqueMessages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={initialBottomPinned ? { index: "LAST", align: "end", behavior: "auto" } : undefined}
      // NOTE: `alignToBottom` was removed. With anchored prepends
      // (`firstItemIndex` shifting backwards by the page size), `alignToBottom`
      // pins the BOTTOM of the viewport when content grows above the current
      // scroll position. The visible result is exactly the reported symptom:
      // user scrolls up, hits the top of the loaded set, the older page lands
      // ~1–2s later, and the viewport "jumps higher" to messages they never
      // scrolled through — because the bottom-anchor lets the topmost visible
      // row swap to a much older one. The initial-mount bottom pin is already
      // handled by `initialTopMostItemIndex={LAST, end}` and the belt-and-
      // braces `scrollToIndex` effect, so `alignToBottom` is not needed for
      // first-paint and actively breaks anchored pagination.
      startReached={handleStartReached}
      atTopStateChange={handleAtTopStateChange}
      atTopThreshold={400}
      atBottomStateChange={handleAtBottomChange}
      onScroll={handleScroll}
      followOutput={initialBottomPinned ? followOutput : false}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      itemSize={itemSize}
      // Tuned to the real median chat row height: most rows fall in the
      // 90–180px band (text bubble + author + timestamp ≈ 90, image rows
      // with the reserved 4/3 frame ≈ 300). 160 is the population median
      // and minimises the magnitude of the post-measure correction Virtuoso
      // applies to unmeasured rows during a fast upward fling.
      defaultItemHeight={160}
      scrollSeekConfiguration={false}
      // Asymmetric overscan: jank on this app is overwhelmingly on UPWARD
      // scrolls into older history (rows that have never mounted, with
      // variable heights). Reserve a wider top viewport so a hard fling
      // (~2000px in <300ms on a phone) lands inside already-measured
      // territory; keep bottom modest because incoming-message growth is
      // already handled by `followOutput`. Bumping `minOverscanItemCount.top`
      // alongside ensures very tall rows (image + reactions ≈ 360px) are
      // pre-mounted by row count, not just by pixel budget.
      increaseViewportBy={{ top: 1600, bottom: 240 }}
      minOverscanItemCount={{ top: 12, bottom: 2 }}
      atBottomThreshold={120}
      scrollerRef={wrappedScrollerRef}
      context={virtuosoContext}
      components={components as any}
    />
    {isJumpHydrating ? <JumpHydrationSkeleton /> : null}
    </div>
  );
}

const VirtuosoChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;

/**
 * Public wrapper that picks between the real Virtuoso-backed list and the
 * basic mapped fallback based on the app-admin kill-switch flag. Splitting
 * the choice at the component boundary (rather than via an early return
 * inside the inner component) keeps the Rules of Hooks intact when the flag
 * flips at runtime via cache invalidation.
 */
function VirtualizedChatMessageListSwitcher<TMessage extends { id: string }>(
  props: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const enabled = useChatVirtualizationEnabled();
  if (!enabled) {
    return <BasicChatMessageList ref={ref as React.Ref<any>} {...props} />;
  }
  return <VirtuosoChatMessageList ref={ref} {...props} />;
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListSwitcher) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
