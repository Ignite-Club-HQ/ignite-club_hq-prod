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
  debugLogEvent,
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
import { getCachedImageAspectRatio, prefetchChatImageAspectRatio } from "@/lib/chatImageAspectCache";
import {
  installChatScrollIntentTracking,
  isViewportTouching,
  isViewportUserActive,
} from "@/lib/chatScrollIntent";
import { BasicChatMessageList } from "./BasicChatMessageList";
import { getLastChatScrollAt, runWhenChatScrollIdle } from "@/lib/chatScrollActivity";
import { useChatVirtualizationEnabled } from "@/hooks/useChatVirtualizationEnabled";
import { isChatJumpActive, setChatJumpActive, subscribeChatJumpActive } from "@/lib/chatJumpActive";
import { isRecentChatScrollWrite, markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";
import { waitForChatJumpTargetReveal } from "@/lib/chatJumpReveal";
import { chatJumpLifecycleRemaining, getChatJumpLifecycle } from "@/lib/chatJumpLifecycle";

import { getChatBottomPaddingOffset } from "@/lib/chatBottomPadding";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";

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
  scrollToBottom: (behavior?: "auto" | "smooth", options?: { force?: boolean }) => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  scrollToMessageId: (messageId: string, align?: "start" | "center" | "end") => boolean;
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
  /** Mount this message in view immediately for exact notification jumps. */
  initialTargetMessageId?: string | null;
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

function escapeCssAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getMessageDay(value?: string | null) {
  return value ? new Date(value).toDateString() : "";
}

// Approx characters that fit on one line of a chat bubble at the current
// viewport. Bubble max-width ≈ 75% of viewport, ~7.2px per char at 14px body
// font. Memoised lazily so we don't read window on every estimate call.
let __cachedOwnCharsPerLine = 0;
let __cachedIncomingCharsPerLine = 0;
let __cachedViewportWidth = 0;
function getCharsPerLine(isOwnMessage: boolean) {
  const w = typeof window !== "undefined" ? window.innerWidth : 411;
  if (w !== __cachedViewportWidth) {
    __cachedViewportWidth = w;
    // Match the real mobile row geometry. Incoming grouped chats lose space to
    // avatar + gap; own messages do not. Use a deliberately conservative
    // average glyph width so long messages don't land hundreds of px short.
    const rowWidth = Math.max(260, w - 32);
    const ownInner = Math.max(140, rowWidth * 0.82 - 24);
    const incomingInner = Math.max(130, rowWidth * 0.85 - 44 - 24);
    __cachedOwnCharsPerLine = Math.max(14, Math.floor(ownInner / 7.4));
    __cachedIncomingCharsPerLine = Math.max(14, Math.floor(incomingInner / 7.4));
  }
  return isOwnMessage ? __cachedOwnCharsPerLine : __cachedIncomingCharsPerLine;
}

function looksLikeYoutubeUrl(text: string) {
  return /(?:youtube\.com\/(?:watch\?|shorts\/|embed\/)|youtu\.be\/)/i.test(text);
}

const PLAIN_URL_REGEX = /(?:https?:\/\/|www\.)[^\s\]]+/gi;
function estimateVisibleText(rawText: string) {
  return rawText
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/(?:https?:\/\/[^\s]*)?\/events\/[0-9a-f-]{36}(?:\S*)?/gi, "")
    .replace(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt):[^\]]+\]/gi, "")
    .replace(PLAIN_URL_REGEX, (url) => looksLikeYoutubeUrl(url) ? "" : "x".repeat(Math.min(50, url.length)))
    .trim();
}

function estimateExternalPreviewHeight(text: string) {
  const seen = new Set<string>();
  let youtubeCount = 0;
  let otherCount = 0;
  for (const match of text.matchAll(PLAIN_URL_REGEX)) {
    const url = match[0];
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (looksLikeYoutubeUrl(url)) {
      if (youtubeCount < 2) youtubeCount += 1;
    } else if (otherCount < 2) {
      otherCount += 1;
    }
  }
  const youtubeHeight = youtubeCount * 180 + Math.max(0, youtubeCount - 1) * 8;
  const linkHeight = otherCount * PREVIEW_HEIGHT_BY_TOKEN.url + Math.max(0, otherCount - 1) * 8;
  return youtubeHeight + linkHeight;
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
  // Aligned with each card's fixed-height loading skeleton so the row
  // estimate matches the very first paint AND the post-hydration paint
  // (skeletons now have the same outer dimensions as the loaded cards).
  // This kills the skeleton→card growth that pushed rows below downward
  // after the user stopped scrolling.
  event: 76,        // EventLinkCard skeleton h-[76px]
  poll: 180,        // PollCard loading still varies; keep conservative.
  board: 80,        // BoardLinkCard skeleton h-[80px]
  vault: 64,        // VaultFileCard skeletons h-[64px]
  vaultfolder: 64,
  vaultroot: 64,
  gallery: 240,     // GalleryLinkCard hero is fixed to 240px to prevent late growth.
  galleryprompt: 76,
  // Generic URL previews. LinkPreview reserves h-20 (80px) when
  // reserveSpace=true (chat history path), so match that exactly.
  url: 80,
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
function chatRowSignature<TMessage extends { id?: string }>(
  message: TMessage | unknown,
  index?: number,
  messages?: TMessage[],
  currentUserId?: string | null,
): string {
  const m = (message ?? {}) as {
    id?: string | null;
    author_id?: string | null;
    text?: string | null;
    image_url?: string | null;
    imageUrl?: string | null;
    edited_at?: string | null;
    is_edited?: boolean | null;
    author_name?: string | null;
    author?: { display_name?: string | null } | null;
    profiles?: { display_name?: string | null } | null;
    reply_to?: { id?: string } | null;
    reply_to_id?: string | null;
    reactions?: Array<{ emoji?: string; user_id?: string } | unknown> | null;
    link_preview?: unknown;
    link_previews?: unknown;
    preview?: unknown;
    __readStateSignature?: string;
  };
  const prev = typeof index === "number" && messages ? messages[index - 1] : undefined;
  const next = typeof index === "number" && messages ? messages[index + 1] : undefined;
  const currentDay = getMessageDay((m as { created_at?: string | null }).created_at);
  const prevDay = getMessageDay((prev as { created_at?: string | null } | undefined)?.created_at);
  const hasDateSeparator = !!currentDay && (!prevDay || prevDay !== currentDay);
  const groupedWithPrev = !!prev && shouldGroupWithPrev(m, prev as any);
  const groupedWithNext = !!next && shouldGroupWithPrev(next as any, m);
  const isOwnMessage = !!currentUserId && m.author_id === currentUserId;
  const authorName = m.author_name ?? m.author?.display_name ?? m.profiles?.display_name ?? "";
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
  // Include the cached image aspect ratio. A novel image first estimates at
  // 4:3, then stores its real ratio after decode; without the ratio in this
  // signature, the row-height cache can keep returning the old 4:3 height on
  // remount and force Virtuoso to patch paddingTop mid-scroll.
  const aspect = img ? (getCachedImageAspectRatio([img])?.toFixed(3) ?? "0") : "";
  // Link-preview hydration: just the presence/shape, not the payload.
  const hasPreview =
    (m.link_preview ? 1 : 0) | (m.link_previews ? 2 : 0) | (m.preview ? 4 : 0);
  return `${text.length}:${text.slice(0, 64)}|${img.length}:${aspect}|${edited}|${replyId}|${rxCount}.${rxEmojiLen}|${hasPreview}|ctx:${hasDateSeparator ? 1 : 0}.${groupedWithPrev ? 1 : 0}.${groupedWithNext ? 1 : 0}.${isOwnMessage ? 1 : 0}.${authorName.length}.${m.__readStateSignature ?? ""}`;
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
  const cached = getCachedRowHeight(message.id, chatRowSignature(message, index, messages, currentUserId));
  if (cached !== undefined) return cached;
  const msg = message as TMessage & {
    author_name?: string | null;
    author?: { display_name?: string | null } | null;
    profiles?: { display_name?: string | null } | null;
    edited_at?: string | null;
    is_edited?: boolean | null;
  } & EstimableChatMessage;
  const prev = messages[index - 1] as (TMessage & EstimableChatMessage) | undefined;
  const next = messages[index + 1] as (TMessage & EstimableChatMessage) | undefined;
  let height = 16; // row wrapper top padding (pt-4)
  const groupedWithPrev = !!prev && shouldGroupWithPrev(msg, prev);
  const groupedWithNext = !!next && shouldGroupWithPrev(next, msg);
  // ChatMessage applies `-mt-3` on grouped follow-ups. Mirror that net row
  // height here so Virtuoso doesn't over-reserve then shrink paddingTop.
  if (groupedWithPrev) height -= 12;

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
    return height + (kind === "galleryprompt" ? 76 : 240);
  }

  if (msg.is_system_message) return Math.max(52, height + 36);

  // Author / header line. ChatMessage hides the author name when the
  // previous visible row is from the SAME author within a short window
  // (consecutive bubbles are grouped). Mirror that here — counting an
  // always-present 24px header was the dominant -34px over-estimate seen
  // in production telemetry.
  const isOwnMessage = !!currentUserId && msg.author_id === currentUserId;
  const showAuthorHeader = !isOwnMessage && !groupedWithPrev;
  if (showAuthorHeader) {
    const authorChars = (
      msg.author_name
      ?? msg.author?.display_name
      ?? msg.profiles?.display_name
      ?? "Loading..."
    ).length;
    // Avatar + name + spacing in ChatMessage. Round-4 telemetry: 32/46 was
    // still ~10px too tall vs the real header.
    height += authorChars > 24 ? 36 : 24;
  }

  // ReplyIndicator: locked to h-[42px] in ReplyPreview.tsx + mb-1 (4px) +
  // bubble inner padding + the extra gap above the bubble that the indicator
  // pushes out. Round-7 telemetry on /messages/:teamId shows text+reply
  // rows consistently under by +38px with chrome=32 (estimated 224 vs
  // measured 262 across many rows of the same id). Bumping to 70 closes the
  // gap — measured≈estimated means Virtuoso doesn't patch paddingTop after
  // the row mounts, eliminating the post-fling jolt.
  if (hasReply) height += 70;

  // Image bubble: rendered at fixed width 300px with the natural aspect
  // ratio (clamped 3/4..16/9) once decoded. Use the persisted aspect cache
  // (chatImageAspectCache, populated on previous decodes) so the estimator
  // matches the real reserved box instead of the 4:3 default. Fall back to
  // 4:3 (= 225px) for never-seen images.
  if (hasImage) {
    const imgUrl = (msg.image_url || msg.imageUrl) ?? null;
    const cachedRatio = getCachedImageAspectRatio([imgUrl]);
    const ratio = cachedRatio ?? (4 / 3);
    // 300 / ratio = pixel height of the reserved aspect-ratio box.
    height += Math.round(300 / ratio);
  }

  const visibleText = estimateVisibleText(text);

  if (visibleText) {
    const charsPerLine = getCharsPerLine(isOwnMessage);
    const explicitLines = visibleText.split(/\n/);
    let lineCount = 0;
    for (const line of explicitLines) {
      lineCount += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    // ~18px per visual line. Round-3 used 19 which over-estimated long
    // messages by ~100px (833→719 measured).
    height += lineCount * 18;
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
  previewHeight += estimateExternalPreviewHeight(text);
  height += previewHeight;

  // Bubble vertical padding + timestamp strip. Round-12: reverted Round-11
  // chrome bump (28/32). Tuning this constant just moves the post-mount
  // correction's sign — flicker is unchanged because Virtuoso still patches
  // paddingTop whenever measured ≠ estimated. The real fix is upstream:
  // either eliminate the post-mount correction window OR stop prepending
  // rows during active scroll. Constant is back at 4/8 baseline.
  if (visibleText || hasReply || previewHeight > 0) height += groupedWithNext ? 4 : 8;

  else if (hasImage) height += groupedWithNext ? 18 : 34;


  // Reactions row wraps every ~4 chips on a phone-width bubble.
  if (reactions) height += Math.ceil(reactions / 4) * 28;

  if (msg.edited_at || msg.is_edited) height += 4;


  // Allow tall rows — long messages of 30+ wrapped lines genuinely measure
  // 900-1100px, and capping at 960 reintroduced late paddingTop corrections.
  return Math.max(56, Math.min(1400, height));
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
        // iOS WebKit momentum scrolling. Harmless on Android/Chromium.
        // Do not add transform/will-change here: promoted overflow scrollers
        // with virtualized children flicker in Android WebView during upward
        // momentum when rows mount and Virtuoso updates paddingTop.
        WebkitOverflowScrolling: "touch",
      } as React.CSSProperties}
    />
  ),
);
ChatVirtuosoScroller.displayName = "ChatVirtuosoScroller";

// `skipAnimationFrameInResizeObserver` (set on <Virtuoso/> below) makes item
// measurement synchronous inside the ResizeObserver callback. The browser
// then legitimately reports the benign "ResizeObserver loop completed with
// undelivered notifications" error (per react-virtuoso docs / issue #1049).
// Swallow ONLY that specific message so it doesn't pollute error overlays
// or monitoring. Installed once at module load.
if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (event) => {
      const msg = typeof event.message === "string" ? event.message : "";
      if (msg.includes("ResizeObserver loop")) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    // Capture so we run before dev overlays / error reporters.
    true,
  );
}



// Custom Item wrapper that applies CSS containment to each virtualised row.
// This is the single biggest win for fast upward scrolls on native: when a
// row mounts it can no longer invalidate ancestor layout/paint, so the
// 1400px upward overscan (which mounts many rows during a fast flick) stops
// causing main-thread layout thrash.
//
// IMPORTANT: We use `contain: layout style` (NOT `content`) because `content`
// implies `paint`, which promotes every row to its own rasterisation layer.
// On Android WebView, mounting a paint-contained element during a prepend
// causes a one-frame white flash before the layer's contents are rasterised
// — this is the "flash when older messages load" the user reports. Layout
// containment alone gives us the layout-isolation win without the per-row
// rasterisation cost.
const ChatVirtuosoItem = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, itemRef) => (
    <div
      {...props}
      ref={itemRef}
      data-chat-virtuoso-item="true"
      style={{
        ...style,
        contain: "layout style",
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
  // fires, so capture it eagerly. Also fires a short-lived ResizeObserver to
  // catch animated/late layout changes (Android WebView skips the live
  // observer above, and Virtuoso's own observer can miss a reaction chip
  // landing inside a `contain: layout` wrapper — visible as overlapping rows
  // immediately after reacting).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = () => {
      const el2 = ref.current;
      if (!el2) return;
      const h = el2.offsetHeight;
      if (h > 0) setCachedRowHeight(messageId, h, signature);
    };
    // Late writes (rAF, 120ms, 360ms, short-RO) update measured heights
    // *after* the row has already mounted. If the user is actively scrolling
    // (or just stopped), pushing those updates into Virtuoso's itemSize cache
    // mid-fling causes visible row shifts: the message the user is reading
    // jolts down/up as a row above re-measures. Defer all late writes until
    // the chat scroller has been idle for ~600ms (bumped from 400ms — the
    // post-fling compositor settle on Android WebView regularly takes
    // 450–550ms before paddingTop corrections stop landing, and writes
    // inside that window were the residual cause of "messages drift down
    // after I stop scrolling").
    const IDLE_MS = 600;
    let cancelIdle: (() => void) | null = null;
    let raf: number | null = null;
    let t1: ReturnType<typeof setTimeout> | null = null;
    let t2: ReturnType<typeof setTimeout> | null = null;
    let ro: ResizeObserver | null = null;
    let roTimer: ReturnType<typeof setTimeout> | null = null;

    // Immediate write is safe on web — it lands in the same layout pass.
    // Android WebView: if the user is actively scrolling, even a same-pass
    // setCachedRowHeight feeds Virtuoso's itemSize cache mid-touch and the
    // compositor re-rasterises the visible band for one frame = the slow
    // scroll-up flicker. Defer to scroll-idle on Android only; web keeps
    // the synchronous write so reactions/edits commit without delay.
    if (isAndroidNativeWebView()) {
      const sinceScrollEager = performance.now() - getLastChatScrollAt();
      if (sinceScrollEager >= IDLE_MS) {
        write();
      } else {
        cancelIdle = runWhenChatScrollIdle(write, IDLE_MS);
      }
    } else {
      write();
    }

    const writeWhenIdle = () => {
      const since = performance.now() - getLastChatScrollAt();
      if (since >= IDLE_MS) {
        write();
        return;
      }
      cancelIdle?.();
      cancelIdle = runWhenChatScrollIdle(write, IDLE_MS);
    };

    const scheduleLateWrites = () => {
      raf = requestAnimationFrame(writeWhenIdle);
      t1 = setTimeout(writeWhenIdle, 120);
      t2 = setTimeout(writeWhenIdle, 360);
      // Android WebView: skip the short-lived ResizeObserver. On slow upward
      // scroll with realtime read receipts firing, dozens of 600ms ROs stack
      // up and land deferred itemSize writes the moment the user pauses,
      // producing visible paddingTop jolts that read as flicker. The rAF +
      // 120ms + 360ms timeouts above (all scroll-idle gated) are sufficient
      // to capture late content like link previews / reaction chips.
      if (isAndroidNativeWebView()) return;
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          // RO can fire during a scroll-driven re-layout. Gate again.
          writeWhenIdle();
        });
        ro.observe(el);
        roTimer = setTimeout(() => {
          ro?.disconnect();
          ro = null;
        }, 600);
      }
    };

    const since = performance.now() - getLastChatScrollAt();
    if (since >= IDLE_MS) {
      scheduleLateWrites();
    } else {
      cancelIdle = runWhenChatScrollIdle(scheduleLateWrites, IDLE_MS);
    }

    return () => {
      cancelIdle?.();
      if (raf !== null) cancelAnimationFrame(raf);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (roTimer) clearTimeout(roTimer);
      ro?.disconnect();
    };
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
  signature: string;
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
    signature,
    renderItemRef,
    uniqueMessagesRef,
    indexByIdRef,
    currentUserIdRef,
  }: ChatRowAdapterProps) {
    const idx = indexByIdRef.current.get(message.id);
    if (idx === undefined) return null;
    const rows = uniqueMessagesRef.current;
    const currentUserId = currentUserIdRef.current;
    const child = renderItemRef.current(message, idx, rows);
    const debug = isChatVirtDebugEnabled();
    const estimated =
      debug && idx >= 0
        ? estimateChatRowHeight(message as any, idx, rows, currentUserId)
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
  // Skip re-render unless THIS row's layout-affecting signature changed.
  // Using signature equality (not message reference) means upstream churn —
  // read-receipt merges, profile-cache refreshes, prepend-page object
  // re-spreading — no longer re-renders every visible row. Only edits,
  // reactions, link-preview hydration, neighbour-grouping changes etc.
  // (anything chatRowSignature captures) trigger a real re-render.
  // Ref props are stable for the lifetime of the parent component.
  (prev, next) => prev.signature === next.signature && prev.message.id === next.message.id,
);

/**
 * Lightweight skeleton overlay shown briefly while a deep-link / jump-to-
 * message is hydrating. Uses semantic tokens so it follows the active theme,
 * and `pointer-events-none` so the user can still scroll/tap underneath if
 * they want to abort.
 */
function JumpHydrationSkeleton({ visible = true }: { visible?: boolean }) {
  const rows = [82, 64, 96, 72, 88, 60, 78];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-3 px-4 pb-6"
      style={{
        // Solid background — any translucency lets the underlying virtualised
        // list bleed through and the user sees the multi-pass settle "bobble"
        // as deferred row heights stabilise. Solid + fade-out transition
        // makes the chat appear fully settled when the overlay lifts.
        // NOTE: do NOT add backdrop-filter here. On Android WebView, a
        // backdrop blur layered over a virtualised scroller forces the
        // compositor to re-rasterise on every scroll frame and causes
        // multi-second freezes.
        background: "hsl(var(--background))",
        opacity: visible ? 1 : 0,
        // Slow fade-out so the underlying chat is already stationary by the
        // time it becomes visible — no perceptible bobble after a deep link.
        transition: "opacity 260ms ease-out",
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


/**
 * Defers prepended history pages until the user's scroll gesture has gone
 * idle.
 *
 * Virtuoso applies a `paddingTop` correction whenever a freshly prepended
 * row's measured height differs from its estimate. When that correction
 * fires DURING an active flick it fights the browser's momentum scrolling
 * and shows up as flicker / re-anchoring. (Off-screen pre-measure was
 * attempted and reverted: heights measured outside the live Virtuoso item
 * container were systematically wrong, poisoning the row-height cache and
 * causing post-stop jolts.)
 *
 * Instead: when a prepend page arrives while the user is still actively
 * scrolling, hold it. Commit the merge only once the chat viewport has been
 * idle for `PREPEND_IDLE_MS`. Stationary commits let Virtuoso adjust
 * scrollTop + paddingTop atomically with no momentum to fight, so the
 * visible rows stay put.
 *
 * Appends / edits / interleaves always commit immediately — realtime and
 * send paths are never delayed.
 */
// Prepend commit gate.
//
// Commit older pages only inside the same user-driven scroll session that
// requested them. Once Virtuoso reports `isScrolling=false`, every unresolved
// prepend is frozen until the next explicit upward gesture. This closes the
// fast-scroll failure mode where a fetch resolves 50–250ms after inertia ends:
// `firstItemIndex` shifts, Virtuoso measures the new page, and a stationary
// viewport visibly moves down.
const PREPEND_MOTION_WINDOW_MS = 250;
const PREPEND_INPUT_SESSION_MS = 300;

let flushPendingPrependOnMotion: (() => void) | null = null;
let lastPrependUpwardMotionAt = 0;
let lastPrependInputAt = 0;
let lastPrependScrollStoppedAt = 0;
let prependVirtuosoIsScrolling = false;
let prependScrollSessionIsUserDriven = false;

function markPrependUserInput() {
  if (typeof performance !== "undefined") lastPrependInputAt = performance.now();
}

function setPrependVirtuosoScrolling(scrolling: boolean) {
  if (typeof performance === "undefined") return;
  const now = performance.now();
  const scroller = scrollerElRefForPrepend?.();
  if (scrolling) {
    prependVirtuosoIsScrolling = true;
    prependScrollSessionIsUserDriven =
      (!!scroller && isViewportTouching(scroller)) ||
      now - lastPrependInputAt <= PREPEND_INPUT_SESSION_MS;
    return;
  }

  prependVirtuosoIsScrolling = false;
  prependScrollSessionIsUserDriven = false;
  lastPrependScrollStoppedAt = now;
}

function canRecordPrependUpwardMotion(explicitGesture = false) {
  if (explicitGesture) return true;
  const scroller = scrollerElRefForPrepend?.();
  if (scroller && isViewportTouching(scroller)) return true;
  return prependVirtuosoIsScrolling && prependScrollSessionIsUserDriven;
}

function isPrependMotionActive() {
  if (typeof performance === "undefined") return false;
  const scroller = scrollerElRefForPrepend?.();
  if (scroller && isViewportTouching(scroller)) return true;
  if (!prependVirtuosoIsScrolling || !prependScrollSessionIsUserDriven) return false;
  if (lastPrependScrollStoppedAt >= lastPrependUpwardMotionAt) return false;
  return performance.now() - lastPrependUpwardMotionAt <= PREPEND_MOTION_WINDOW_MS;
}

function markPrependUpwardMotion(options: { explicitGesture?: boolean } = {}) {
  if (!canRecordPrependUpwardMotion(options.explicitGesture)) return false;
  if (typeof performance !== "undefined") lastPrependUpwardMotionAt = performance.now();
  flushPendingPrependOnMotion?.();
  return true;
}

function useDeferPrependsWhileScrolling<TMessage extends { id: string }>(
  messagesProp: TMessage[],
): TMessage[] {
  const [committed, setCommitted] = useState<TMessage[]>(messagesProp);
  const committedRef = useRef(committed);
  const pendingPrependRef = useRef<TMessage[] | null>(null);
  committedRef.current = committed;

  useEffect(() => {
    const flush = () => {
      const pending = pendingPrependRef.current;
      if (!pending || !isPrependMotionActive()) return;
      pendingPrependRef.current = null;
      setCommitted(pending);
      debugLogEvent("prepend-flush-on-motion", { len: pending.length });
    };
    flushPendingPrependOnMotion = flush;
    return () => {
      if (flushPendingPrependOnMotion === flush) flushPendingPrependOnMotion = null;
    };
  }, []);

  useEffect(() => {
    if (messagesProp === committedRef.current) return;

    const current = committedRef.current;
    const committedIds = new Set<string>();
    for (const m of current) committedIds.add(m.id);

    const newRows: TMessage[] = [];
    for (const m of messagesProp) if (!committedIds.has(m.id)) newRows.push(m);
    if (newRows.length === 0 || current.length === 0) {
      pendingPrependRef.current = null;
      setCommitted(messagesProp);
      return;
    }

    let isPurePrepend = messagesProp.length >= newRows.length;
    for (let i = 0; i < newRows.length && isPurePrepend; i++) {
      if (messagesProp[i]?.id !== newRows[i].id) isPurePrepend = false;
    }
    if (!isPurePrepend) {
      pendingPrependRef.current = null;
      setCommitted(messagesProp);
      return;
    }

    // Pure prepend. If the fetch resolves while the viewport is still moving,
    // commit immediately so Virtuoso's firstItemIndex/paddingTop correction is
    // hidden inside the gesture. If it resolves AFTER motion stops, do not
    // commit on a stationary screen — hold the page until the next upward
    // gesture, so rows stay frozen exactly where the user stopped.
    if (isPrependMotionActive()) {
      pendingPrependRef.current = null;
      setCommitted(messagesProp);
      return;
    }

    pendingPrependRef.current = messagesProp;
    debugLogEvent("prepend-held-until-motion", { len: messagesProp.length, added: newRows.length });
  }, [messagesProp]);

  return committed;
}


// Module-level pointer so the prepend deferral effect (defined outside the
// component) can ask the live Virtuoso scroller whether a finger is currently
// on the glass. Set/cleared by the component on mount/unmount.
let scrollerElRefForPrepend: (() => HTMLElement | null) | null = null;

function VirtualizedChatMessageListInner<TMessage extends { id: string }>(
  {
    messages: messagesProp,
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
    initialTargetMessageId = null,
    currentUserId,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  // Expose this scroller to the module-level prepend gate so it can check
  // whether a finger is currently on the glass before committing a held page.
  useEffect(() => {
    scrollerElRefForPrepend = () => scrollerElRef.current;
    return () => {
      scrollerElRefForPrepend = null;
    };
  }, []);
  // Prepended history pages are held until the scroll gesture goes idle so
  // Virtuoso's paddingTop correction never fires mid-flick. `messages` below
  // is the committed array — the rest of the body operates on it unchanged.
  const messages = useDeferPrependsWhileScrolling(messagesProp);
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
  
  hasOlderRef.current = hasOlder;
  isLoadingOlderRef.current = isLoadingOlder;
  onLoadOlderRef.current = onLoadOlder;
  // Synchronous in-flight guard for `startReached`. The parent's
  // `isLoadingOlder` state flips via setState, so two `startReached` events
  // fired in the same frame on a fast upward flick both see `false` and
  // double-fetch — the prepended page is then merged twice into the data
  // array, producing duplicate IDs and "ghost" rows in Virtuoso.
  const loadingOlderInFlightRef = useRef(false);
  // `userHasScrolledAfterPinRef` is intentionally sticky for first-open pin
  // suppression, but it must NOT be used as permission to keep paginating.
  // After a fast flick stops, Virtuoso can re-fire `startReached` while it is
  // reconciling prepended row measurements; requiring a very recent upward
  // scroll event prevents those render-owned callbacks from queueing another
  // older-page fetch after the user's thumb/inertia has actually settled.
  const lastObservedScrollTopRef = useRef<number | null>(null);
  const lastUserUpwardScrollAtRef = useRef(0);
  // Tightened from 220 → 100ms: the trailing 120ms of the window was firing
  // `startReached` right as a fast fling decelerated, landing a prepend
  // page just after the user stopped — visible as "rows keep moving after I
  // stop". 100ms still covers a genuine continuous upward gesture (Virtuoso
  // re-fires startReached on every page boundary at ~60fps); it only drops
  // the tail-end fire that has no live finger or live momentum behind it.
  // The edge-pin fallback below still requires an active touch.
  const PREPEND_USER_SCROLL_ACTIVE_MS = 100;
  const hasRecentUserUpwardScroll = useCallback(() => {
    if (performance.now() - lastUserUpwardScrollAtRef.current <= PREPEND_USER_SCROLL_ACTIVE_MS) {
      return true;
    }
    // Edge-pin fallback: once scrollTop hits 0 the browser stops emitting
    // upward scroll deltas. Only treat this as continuing upward intent if a
    // finger is STILL on the glass — using the broader `isViewportUserActive`
    // cooldown (600ms) caused `startReached` to keep firing after release,
    // which surfaced as "messages keep moving after I stopped".
    const el = scrollerElRef.current;
    if (el && el.scrollTop <= 4 && isViewportTouching(el)) return true;
    return false;
  }, []);

  // Min gap between two prepend fetches. After a page lands, fast upward
  // flings can immediately retrigger `startReached` / `atTopStateChange`
  // before the browser has rasterised the newly-mounted rows — producing a
  // visible flicker as Virtuoso prepends a second page on top of an
  // unsettled layout. We enforce a short cooldown so each prepend has time
  // to paint before the next one is allowed.
  // 600ms (was 350ms): on Android WebView a fast upward fling can land a
  // prepend page before the previous one's freshly-mounted rows have
  // rasterised. Stacking two `firstItemIndex` shifts inside that window is
  // the dominant cause of the "flicker on fast scroll-up" reports — the
  // second page's estimate→measured paddingTop correction lands on top of
  // an already-unsettled layout. 600ms gives the previous prepend a full
  // ~36-frame window to settle before another is allowed. Genuine repeat
  // upward gestures past the cooldown still trigger `startReached` /
  // `atTopStateChange` naturally, so this only suppresses the back-to-back
  // case, not normal pagination.
  const PREPEND_COOLDOWN_MS = 600;
  const lastPrependLandedAtRef = useRef(0);
  // Once messages.length grows, the prepend has landed — release the guard.
  useEffect(() => {
    if (messages.length > messagesLengthRef.current) {
      loadingOlderInFlightRef.current = false;
      lastPrependLandedAtRef.current = performance.now();
    }
    // Diagnostic: a wholesale window collapse (e.g. 270 → 100 rows) means a
    // parent replaced the rendered array — the precursor to the post-scroll
    // "teleport to bottom" jolt seen in field telemetry.
    if (messages.length < messagesLengthRef.current - 5) {
      debugLogEvent("window-shrink", {
        prevLen: messagesLengthRef.current,
        nextLen: messages.length,
      });
    }
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Diagnostic: full remounts re-run the initial bottom pin at revision 0 and
  // teleport a history-reading user back to LAST. Log mount/unmount so a
  // field dump can distinguish remount from in-place anchor reset.
  useEffect(() => {
    debugLogEvent("list-mount", { messagesLen: messagesLengthRef.current });
    return () => {
      debugLogEvent("list-unmount", { messagesLen: messagesLengthRef.current });
    };
  }, []);

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
      lastPrependLandedAtRef.current = performance.now();
    }
    prevIsLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder]);


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
  // Memoise the O(n) anchor lookup. Without this it runs on every parent
  // render (200+ comparisons on a typical chat) and during a prepend +
  // Virtuoso measurement burst it can fire 20-40×/s, adding pure main-thread
  // jank to the fast-scroll budget.
  const baseOffset = useMemo(() => {
    if (messages.length === 0) return 0;
    if (!baseFirstId) return -1;
    return messages.findIndex((message) => message.id === baseFirstId);
  }, [messages, baseFirstId]);
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
  // Tail id of the list at the moment it was last revealed. Used to tell a
  // "cached/placeholder → authoritative response corrected the head" swap
  // (same tail, already visible: must NOT re-hide) apart from a genuine
  // thread/anchor change.
  const revealedTailIdRef = useRef<string | null>(null);
  const initialRevealReadyRef = useRef(false);
  initialRevealReadyRef.current = initialRevealReady;
  if (initialRevealReady && lastMessageId) revealedTailIdRef.current = lastMessageId;
  // ONE-WAY REVEAL LATCH. Once this mount has painted its messages, nothing may
  // put the mask/skeleton back over them. The bottom-pin effect below re-runs on
  // every `bottomPinRevision` bump, and a bump is unavoidable when an anchor
  // reset coincides with a NEW message arriving (the `alreadyRevealedAndStable`
  // guard only covers an unchanged tail). Re-arming `initialRevealReady=false`
  // there is exactly the reported "messages → blank → skeleton → messages"
  // flash. Re-pinning/aligning is still allowed — only the masking is not.
  // Thread changes remount this component (scrollerKey / RemountOnParamChange),
  // so the latch can never leak across threads.
  const hasRevealedOnceRef = useRef(false);
  // Only latch once CONTENT has actually painted — and only from a PASSIVE
  // (post-paint) effect, never during render. Two cold-open races depend on
  // this:
  //   1. Empty-cache open (committee/group chats after launch or a club
  //      switch): the empty branch's 700ms grace reveals an EMPTY list while
  //      the page-level skeleton still covers the thread. That reveal has
  //      nothing on screen to protect, so it must not disarm re-masking —
  //      otherwise when the real messages land (>700ms fetch) the whole
  //      bottom-pin stabilisation sequence (immediate/raf pins, stability
  //      checks, settle pins, Virtuoso's end-align park → true-maxTop
  //      correction) plays out VISIBLY for seconds: the "thread moves up and
  //      down after skeleton reveal" report.
  //   2. The messages-arrive commit itself: a render-phase latch would arm
  //      the moment `initialRevealReady && messages.length > 0` is true —
  //      BEFORE the pin layout effect below gets to call armRevealMask().
  //      A passive effect runs after all layout effects of that commit, so
  //      the pin effect always wins the race and the mask re-arms.
  // The latch still arms after the first painted content reveal, which is
  // what blocks re-masking over already-visible messages (the original
  // flash regression this ref was added for).
  useEffect(() => {
    if (initialRevealReady && messages.length > 0) hasRevealedOnceRef.current = true;
  }, [initialRevealReady, messages.length]);
  const armRevealMask = useCallback(() => {
    if (hasRevealedOnceRef.current) return;
    setInitialRevealReady(false);
  }, []);


  const safeScrollToIndex = useCallback(
    (payload: any, reason: string) => {
      if (messagesLengthRef.current <= 0) {
        debugLogEvent("scroll-to-index-skipped-empty", { reason });
        return false;
      }
      try {
        virtuosoRef.current?.scrollToIndex(payload);
        return true;
      } catch (error) {
        console.warn("[VirtualizedChatMessageList] scrollToIndex skipped", { reason, error });
        return false;
      }
    },
    [],
  );

  /**
   * CANONICAL bottom pin: park at TRUE max scrollTop (footer included).
   *
   * Root cause of the "thread moves up and down after skeleton reveal"
   * bounce: two different "bottom" targets were being written by competing
   * pin paths —
   *   A) `scrollToIndex({ index: "LAST", align: "end" })` parks the last
   *      ROW flush against the viewport bottom, i.e. scrollTop =
   *      maxTop - footerHeight (the bottomPadding footer sits below the
   *      viewport).
   *   B) direct `scrollTop = scrollHeight - clientHeight` writes (RO
   *      stay-pinned guard, open-pin window, scrollToBottom's rAF
   *      follow-up) park at maxTop — 32px further.
   * A reveal that ended with (A) followed by any (B) writer (or the
   * scrollToIndex-then-rAF-maxTop sequence inside `scrollToBottom`)
   * visibly jumped the whole thread up/down by the footer height.
   *
   * From now on EVERY bottom pin converges on (B) in a single synchronous
   * write, so there is no intermediate paint at the end-align position and
   * no disagreement between writers. Virtuoso tolerates direct scrollTop
   * jumps (same mechanism as scrollbar drags); bottom pins are only ever
   * issued at/near the bottom where the tail rows are already mounted
   * (initial mount anchors at LAST, overscan bottom = 600px).
   */
  // NEVER animate this write. A `behavior: "smooth"` glide is cancelled by the
  // next synchronous `scrollTop =` write (own-message pin, bottom-padding
  // re-pin, stay-pinned guard) and the truncated glide + instant jump is the
  // post-send "shake". Every bottom pin is a single instant write; calmness
  // comes from landing the row, composer collapse and footer in ONE frame,
  // not from animating between them.
  const pinToTrueBottom = useCallback(
    (reason: string, _behavior: "auto" | "smooth" = "auto") => {
      if (messagesLengthRef.current <= 0) return false;
      if (isChatJumpActive()) return false;
      const el = scrollerElRef.current;
      if (!el) return false;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const delta = Math.abs(el.scrollTop - maxTop);
      if (delta <= 1) return true;
      debugLogEvent("pin-to-true-bottom", { reason, from: Math.round(el.scrollTop), to: Math.round(maxTop) });
      el.scrollTop = maxTop;
      markChatScrollWrite();
      return true;
    },
    [],
  );


  /**
   * Exact-DOM alignment for a mounted row. Single implementation shared by the
   * imperative `scrollToMessageId` handle and the jump reveal fail-safe, so
   * "one final exact-DOM alignment" is guaranteed to be the same correction
   * the jump itself applies.
   */
  const alignMessageIdInView = useCallback(
    (messageId: string, align: "start" | "center" | "end" = "center") => {
      const el = scrollerElRef.current;
      if (!el) return false;
      const escapedId = escapeCssAttributeValue(messageId);
      const row = el.querySelector<HTMLElement>(`[data-row-id="${escapedId}"]`);
      if (!row) return false;
      const rowRect = row.getBoundingClientRect();
      const scrollerRect = el.getBoundingClientRect();
      // ALWAYS read the LIVE composer inset. Reading a closed-over
      // `bottomPadding` let the initial reveal align against the 56px composer
      // floor while the overlay gate aligned against the measured height, so the
      // two gates computed different offsets and each "corrected" the other —
      // the visible down-then-up settle after the skeleton reveal.
      const reservedBottom =
        align === "end" ? getChatBottomPaddingOffset(bottomPaddingRef.current) : 0;
      const targetTop =
        align === "end"
          ? el.scrollTop + rowRect.bottom - scrollerRect.bottom + reservedBottom
          : align === "start"
          ? el.scrollTop + rowRect.top - scrollerRect.top
          : el.scrollTop + rowRect.top - scrollerRect.top - Math.max(0, (el.clientHeight - rowRect.height) / 2);
      const previousScrollTop = el.scrollTop;
      const nextScrollTop = Math.max(0, targetTop);
      // Epsilon no-op: sub-pixel/1px differences are invisible but a real
      // scroll write re-arms the OTHER reveal gate's quiet window (its
      // scroll/mutation observers see a new geometry signature), producing a
      // late third correction after the user already reads the list as settled.
      if (Math.abs(nextScrollTop - previousScrollTop) < 2) return true;
      el.scrollTo({ top: nextScrollTop, behavior: "auto" });
      markChatScrollWrite();
      console.log("[jumpToMessage] exact DOM correction", {
        messageId,
        align,
        previousScrollTop,
        targetTop: nextScrollTop,
        rowTop: rowRect.top,
        rowBottom: rowRect.bottom,
        scrollerTop: scrollerRect.top,
        scrollerBottom: scrollerRect.bottom,
      });
      return true;
    },
    [],
  );

  // Latest-render mirrors for the mount-once jump overlay effect (deps: []).
  const alignMessageIdInViewRef = useRef(alignMessageIdInView);
  alignMessageIdInViewRef.current = alignMessageIdInView;
  const bottomPaddingRef = useRef(bottomPadding);
  const bottomPaddingChangedAtRef = useRef(0);
  // Set during render (BEFORE the new footer height hits the DOM) when the
  // viewport was sitting at the bottom. The layout effect below then re-pins
  // in the same commit, so a shrinking/growing composer footer can never paint
  // a frame where the thread has slid up (or down) and then snapped back —
  // that pair of frames is the post-send "jump".
  const repinAfterPaddingRef = useRef(false);
  if (bottomPaddingRef.current !== bottomPadding) {
    bottomPaddingRef.current = bottomPadding;
    const el = scrollerElRef.current;
    if (el) {
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      repinAfterPaddingRef.current = maxTop - el.scrollTop <= 24;
    }
    // The composer inset is measured in staggered passes (80/180/360/700ms) and
    // is rendered as an in-flow Virtuoso footer, so every change physically
    // moves the message column. Revealing between those passes is exactly the
    // "moves down then up" artefact — record the change so the reveal gate can
    // wait for the inset to go quiet.
    bottomPaddingChangedAtRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
  }
  /** True once the composer inset has been unchanged for `quietMs`. */
  const bottomPaddingQuiet = useCallback((quietMs = 180) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return now - bottomPaddingChangedAtRef.current >= quietMs;
  }, []);
  // Same-commit re-pin for composer-footer height changes. Runs before paint,
  // so the shrink/grow of the footer and the corrected scrollTop land in ONE
  // frame instead of "slide + snap back".
  useLayoutEffect(() => {
    if (!repinAfterPaddingRef.current) return;
    repinAfterPaddingRef.current = false;
    if (messagesLengthRef.current <= 0) return;
    if (isChatJumpActive()) return;
    const el = scrollerElRef.current;
    if (!el) return;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (Math.abs(el.scrollTop - maxTop) <= 1) return;
    el.scrollTop = maxTop;
    markChatScrollWrite();
  }, [bottomPadding]);
  // Single-owner guard for the exact-DOM correction: while the initial
  // deep-link reveal gate is running, the overlay gate must NOT issue its own
  // competing `finalAlign` for the same target.
  const jumpAlignOwnedByContentGateRef = useRef<string | null>(null);
  // Post-reveal anchor: set by the deep-link content gate the moment it
  // unmasks, consumed by the anchor watcher below. The two bottom-pin guards
  // (stay-pinned RO / open-pin window) are gated on `initialBottomPinned`,
  // which every deep-link page passes as `false` — so without this, rows that
  // hydrate AFTER a notification-jump reveal (read receipts land 2-4s in on a
  // cold start, reactions, link previews, image decode) resize in plain sight
  // and the just-revealed thread visibly shifts.
  const postJumpAnchorRef = useRef<{ id: string; at: number } | null>(null);
  const [jumpAnchorNonce, setJumpAnchorNonce] = useState(0);

  const jumpOverlayTargetRef = useRef<string | null>(initialTargetMessageId ?? null);
  jumpOverlayTargetRef.current = initialTargetMessageId ?? null;




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
      // Already-revealed content whose tail is unchanged means this reset is
      // only anchor bookkeeping (a cached/placeholder head being corrected by
      // the authoritative response). Re-arming the pin here would clear the
      // reveal latch and flash an already-populated thread back to a skeleton.
      const alreadyRevealedAndStable =
        initialRevealReadyRef.current &&
        !!lastMessageId &&
        revealedTailIdRef.current === lastMessageId;
      if (!userIsReadingHistory && !alreadyRevealedAndStable) {
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
        suppressedRePin: userIsReadingHistory || alreadyRevealedAndStable,
      } as Record<string, unknown>);
    }
  }, [needsAnchorReset, newFirstId, messages.length, lastMessageId]);


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
    // Deep-link jump path (push notification / search / reply / pin tap):
    // when an `initialTargetMessageId` was supplied and its row is already
    // in the loaded set, Virtuoso mounted with
    // `initialTopMostItemIndex={index:target, align:"end"}` — the viewport
    // is ALREADY on the correct row. Running the bottom-pin sequence here
    // would immediately snap to LAST/end (the parent's jump effect that
    // sets `isChatJumpActive` runs AFTER this useLayoutEffect in commit
    // ordering, so the guard above misses on the tap that opens/refocuses
    // the chat), producing the visible "message moves around before
    // settling" jitter reported when tapping a notification for a
    // different message in a chat that's already open at another
    // position. Treat as already-pinned, but do NOT reveal immediately: wait
    // until Virtuoso's row measurement, exact-DOM correction, and any visible
    // row hydration have produced a quiet scroller. This branch must run
    // BEFORE the `!initialBottomPinned` shortcut below because every deep-link
    // page passes `initialBottomPinned={false}`.
    if (initialTargetMessageId && initialTargetIndex >= 0) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      pinAttemptRevisionRef.current = null;
      armRevealMask();
      let cancelled = false;
      let cleanup: (() => void) | null = null;
      let revealFrame: number | null = null;
      // ONE lifecycle budget, measured from the ORIGINAL jump start (not from
      // this effect run, which can re-fire on message-window growth). The
      // reveal itself is gated on the exact target being mounted, aligned,
      // unclipped and stationary — see `waitForChatJumpTargetReveal`. This is
      // deliberately the shortest defensible fail-safe: previously we chained a
      // 2.2 s jump tail onto a fresh 6.5 s settle wait (re-armed every 80 ms),
      // which left a correctly aligned thread masked for many seconds.
      const JUMP_REVEAL_FAILSAFE_MS = 4000;
      // This gate owns the exact-DOM correction for this target; the overlay
      // gate defers to it so only ONE alignment authority writes scrollTop.
      jumpAlignOwnedByContentGateRef.current = initialTargetMessageId;
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const reveal = () => {
        cleanup?.();
        revealFrame = requestAnimationFrame(() => setInitialRevealReady(true));
      };
      const finish = () => {
        if (cancelled) return;
        // Do not unmask while the composer inset is still settling — the
        // in-flow Virtuoso footer height changes with it and would move the
        // just-revealed target row. Bounded by the same lifecycle budget.
        const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
        if (!bottomPaddingQuiet(180) && elapsed < JUMP_REVEAL_FAILSAFE_MS) {
          revealFrame = requestAnimationFrame(() => {
            if (cancelled) return;
            alignMessageIdInView(initialTargetMessageId, "end");
            finish();
          });
          return;
        }
        cancelled = true;
        jumpAlignOwnedByContentGateRef.current = null;
        // Arm the post-reveal anchor BEFORE unmasking so late-hydrating rows
        // re-align to the target instead of shifting the revealed thread.
        // Reset the sticky user-scroll flag so a repeat jump in an already-open
        // chat still gets its full anchor window.
        userHasScrolledAfterPinRef.current = false;
        postJumpAnchorRef.current = {
          id: initialTargetMessageId,
          at: typeof performance !== "undefined" ? performance.now() : Date.now(),
        };
        setJumpAnchorNonce((n) => n + 1);
        reveal();
      };
      const wait = () => {
        if (cancelled) return;
        const scroller = scrollerElRef.current;
        if (!scroller) {
          revealFrame = requestAnimationFrame(wait);
          return;
        }
        cleanup = waitForChatJumpTargetReveal(
          scroller,
          {
            targetMessageId: initialTargetMessageId,
            usableBottomInsetPx: getChatBottomPaddingOffset(bottomPaddingRef.current),
            quietMs: 240,
            budgetMs: Math.max(
              600,
              chatJumpLifecycleRemaining(JUMP_REVEAL_FAILSAFE_MS),
            ),
            finalAlign: () => { alignMessageIdInView(initialTargetMessageId, "end"); },
          },
          finish,
        );
      };
      wait();
      return () => {
        cancelled = true;
        if (jumpAlignOwnedByContentGateRef.current === initialTargetMessageId) {
          jumpAlignOwnedByContentGateRef.current = null;
        }
        cleanup?.();
        if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      };

    }


    // Deep-link target requested but its row is NOT in the loaded window yet.
    // Revealing here paints the fallback (bottom/LAST) anchor, and moments
    // later the parent's target-window hydration bumps the scroller key and
    // remounts this list — the user sees content, then a skeleton, then the
    // real target. Stay masked while the target fetch is in flight, bounded by
    // the jump lifecycle budget so a target that never arrives still reveals.
    if (initialTargetMessageId && initialTargetIndex < 0) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      pinAttemptRevisionRef.current = null;
      const TARGET_PENDING_HOLD_MS = 2500;
      const holdMs = Math.max(
        400,
        Math.min(3000, chatJumpLifecycleRemaining(TARGET_PENDING_HOLD_MS)),
      );
      const holdTimer = window.setTimeout(() => setInitialRevealReady(true), holdMs);
      return () => window.clearTimeout(holdTimer);
    }

    if (!initialBottomPinned) {
      bottomPinReadyRef.current = true;
      // Do NOT stamp `pinnedRevisionRef` here. The parent computes
      // `initialBottomPinned={initialBottomPinned && (virtualReady || isPinned)}`,
      // which is frequently `false` on the FIRST render of a mount and flips
      // `true` a frame later. Stamping the revision on that transient false
      // pass made the guard below short-circuit the real pin sequence when the
      // prop flipped, so a plain reopen (e.g. straight after posting a
      // message) revealed wherever Virtuoso happened to mount instead of the
      // bottom — and nothing corrected it afterwards.
      pinnedRevisionRef.current = null;
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
    // Re-mask only when a pin can actually MOVE content. If every row fits
    // inside the viewport (e.g. the first messages landing in a previously
    // empty open thread) maxTop is 0 and every pin below is a no-op — masking
    // would just flash a skeleton over the empty state for no benefit. When
    // the scroller is not measurable yet (missing or zero-sized), default to
    // masking: an unmeasurable layout cannot prove the pins will be no-ops.
    const pinViewportEl = scrollerElRef.current;
    const pinCanMoveContent =
      !pinViewportEl ||
      (pinViewportEl.clientHeight === 0 && pinViewportEl.scrollHeight === 0) ||
      pinViewportEl.scrollHeight > pinViewportEl.clientHeight + 1;
    if (pinCanMoveContent) armRevealMask();
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
      pinToTrueBottom(`bottom-pin-${phase}`);
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
        pinToTrueBottom("bottom-pin-reveal-final");
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
        if (userHasScrolledAfterPinRef.current && !atBottomRef.current) {
          requestAnimationFrame(() => setInitialRevealReady(true));
          return;
        }
        pinToTrueBottom("bottom-pin-settle");
        requestAnimationFrame(() => {
          pinToTrueBottom("bottom-pin-settle-raf");
          setInitialRevealReady(true);
        });
      });
    };
    const armRevealWhenStable = () => {
      const el = scrollerElRef.current;
      if (!el || cancelled) return;
      if (!isChatJumpActive()) {
        pinToTrueBottom("bottom-pin-stability-check");
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
    // `initialTargetMessageId` is included so a NEW deep-link target starts a
    // fresh hydration lifecycle (and cancels the previous one) rather than
    // inheriting an already-expired deadline from another notification.
  }, [bottomPinRevision, messages.length === 0, initialBottomPinned, initialTargetMessageId]);

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
    const userInitiatedTopReach = hasRecentUserUpwardScroll();
    // Trust window: suppress the very first upward fetch right after the
    // initial bottom pin so a cold-open scroll-up cannot trigger a prepend
    // that visually teleports the viewport to older messages the user
    // hasn't scrolled through yet.
    const sincePin = performance.now() - bottomPinReadyAtRef.current;
    if (sincePin < PREPEND_TRUST_WINDOW_MS) {
      debugLogStartReached(false, "trust-window-suppressed");
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
    const sinceLastPrepend = performance.now() - lastPrependLandedAtRef.current;
    if (
      lastPrependLandedAtRef.current > 0 &&
      sinceLastPrepend < PREPEND_COOLDOWN_MS
    ) {
      // Cooldown: a prepend just landed; suppress (do NOT retry). A queued
      // fetch firing after the user stops reads as "messages keep moving
      // after I stopped" — the next genuine upward gesture will retrigger
      // `startReached` naturally.
      debugLogStartReached(false, "cooldown-suppressed");
      return;
    }
    loadingOlderInFlightRef.current = true;
    debugLogStartReached(true, "fetch");
    onLoadOlder();
  }, [hasOlder, isLoadingOlder, onLoadOlder, hasRecentUserUpwardScroll]);

  // When the scroller is already pinned at scrollTop≈0, iOS/Android often do
  // not emit another scroll event for a repeated upward-history gesture. That
  // means neither `startReached` nor `atTopStateChange` fires, so the chat can
  // appear hard-stuck at a page boundary even though older rows exist. Listen
  // directly for edge pull intent and route it through the same guarded loader.
  useEffect(() => {
    const el = scrollerElRef.current;
    if (!el) return;

    let lastTouchY: number | null = null;
    let frame: number | null = null;
    const requestEdgeLoad = () => {
      markPrependUpwardMotion({ explicitGesture: true });
      lastUserUpwardScrollAtRef.current = performance.now();
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (scrollerElRef.current && scrollerElRef.current.scrollTop <= 8) handleStartReached();
      });
    };
    const onTouchStart = (event: TouchEvent) => {
      markPrependUserInput();
      lastTouchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      markPrependUserInput();
      const y = event.touches[0]?.clientY ?? null;
      if (y === null || lastTouchY === null) {
        lastTouchY = y;
        return;
      }
      const deltaY = y - lastTouchY;
      lastTouchY = y;
      if (deltaY > 3 && el.scrollTop <= 8) requestEdgeLoad();
    };
    const onWheel = (event: WheelEvent) => {
      markPrependUserInput();
      if (event.deltaY < -3 && el.scrollTop <= 8) requestEdgeLoad();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("wheel", onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [handleStartReached]);

  // Belt-and-braces upward pagination trigger. With top overscan,
  // `startReached` can fail to refire after a successful prepend because the
  // rendered range still spans data index 0 — the user scrolls up but
  // Virtuoso never sees a transition INTO the start. `atTopStateChange`
  // fires on every transition into/out of the top edge, so we use it to
  // re-invoke the same load logic. The `handleStartReached` body is fully
  // idempotent (trust window + cooldown + in-flight guard + `hasOlder`
  // check), so calling it from both paths is safe. We coalesce rapid
  // re-fires via rAF so a fast flick that produces multiple
  // atTop=true→false→true transitions inside a single frame collapses to
  // one call. We also ignore atTop transitions that fire without an
  // accompanying active user gesture — those are caused by the
  // `firstItemIndex` shift after a prepend lands and would otherwise keep
  // queueing new prepends after the user has stopped scrolling.
  const atTopRafRef = useRef<number | null>(null);
  const handleAtTopStateChange = useCallback(
    (atTop: boolean) => {
      if (!atTop) return;
      if (!hasRecentUserUpwardScroll()) return;
      if (atTopRafRef.current !== null) return;
      atTopRafRef.current = requestAnimationFrame(() => {
        atTopRafRef.current = null;
        handleStartReached();
      });
    },
    [handleStartReached, hasRecentUserUpwardScroll],
  );


  const handleScroll = useCallback(() => {
    if (!bottomPinReadyRef.current) return;
    const el = scrollerElRef.current;
    const currentTop = el?.scrollTop ?? 0;
    const previousTop = lastObservedScrollTopRef.current;
    lastObservedScrollTopRef.current = currentTop;
    // Only treat a scroll event as "user scrolled away" when there is a real
    // user gesture behind it. Programmatic `scrollToIndex` snaps (initial
    // pin, stay-pinned re-anchor, follow-output) also dispatch scroll events
    // and would otherwise permanently disable the post-reveal stay-pinned
    // guard — leaving the last message hidden behind the composer after
    // late avatar/image hydration on first cold-cache open.
    const userDrivenScroll = isViewportUserActive(el) || (prependVirtuosoIsScrolling && prependScrollSessionIsUserDriven);
    if (!userDrivenScroll) return;
    if (previousTop !== null && currentTop < previousTop - 2) {
      markPrependUpwardMotion();
      lastUserUpwardScrollAtRef.current = performance.now();
    }
    userHasScrolledAfterPinRef.current = true;
  }, []);

  const handleIsScrollingChange = useCallback((scrolling: boolean) => {
    setPrependVirtuosoScrolling(scrolling);
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
    // Match the sibling watchers' guard — jsdom (and very old WebViews) have
    // no ResizeObserver; without this the effect throws on reveal.
    if (typeof ResizeObserver === "undefined") return;
    const viewport = scrollerElRef.current;
    if (!viewport) return;
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (!inner) return;

    let cancelled = false;
    const startedAt = performance.now();
    // Cold post-login opens hydrate more slowly than normal re-opens (auth,
    // profiles, avatars, link previews, READ RECEIPTS / read frontier). Keep
    // the first-open bottom guard alive long enough to absorb that settling
    // without affecting a user who has intentionally scrolled away. Matches
    // the open-pin window (6s) so late-hydrating "Seen by" rows on own
    // messages — which can land 2-4s after reveal on a cold start — are
    // compensated before this observer retires.
    const STAY_PINNED_MS = 6000;
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

      // Parked-at-bottom must be judged against the PRE-RESIZE geometry.
      // By the time this callback runs, the growth has already landed:
      // measuring `scrollHeight - clientHeight - scrollTop` NOW turns a
      // parked 0 into the grown delta (e.g. +24px), so the old
      // `distanceFromBottom > 4 → bail` check defeated the guard's own
      // purpose — every real row growth while pinned at bottom was ignored
      // and the tail drifted until an unrelated pin yanked it back (the
      // visible "moves up and down" after reveal).
      const prevDistanceFromBottom =
        lastScrollHeight - lastClientHeight - viewport.scrollTop;

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

      // Hard guards: never re-pin from a ResizeObserver callback when the
      // user has scrolled away from the pin or was NOT parked at the bottom
      // before this resize (reading history / mid-fling). Pure pixel-distance
      // check — atBottomRef is unreliable here because Virtuoso's 120px
      // atBottomThreshold keeps it `true` for the first ~120px of an upward
      // fling.
      if (userHasScrolledAfterPinRef.current) return;
      if (prevDistanceFromBottom > 4) return;

      // Coordinate with sibling writers (openPinWindow timers, parent
      // keyboard-pin). If one of them just wrote scrollTop, skip this pass
      // so we don't apply an opposing micro-correction in the same frame.
      if (isRecentChatScrollWrite(200)) return;

      // Re-pin to the true max scroll position for BOTH growth and shrink.
      // Cold-login row estimates can correct in either direction; only
      // handling positive deltas leaves the browser to clamp negative deltas
      // on the next paint, which reads as the down/up jolt the user reported.
      const maxTop = sh - ch;
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

  // POST-REVEAL JUMP ANCHOR (deep-link / notification path). The stay-pinned
  // RO guard and the open-pin window above both early-return when
  // `initialBottomPinned` is false — which it always is on deep-link pages —
  // so after a jump reveal there was NO writer compensating the late
  // hydration that cold starts deliver over the next several seconds (read
  // receipts at 2-4s, reactions, link previews, image decode). Those resizes
  // played out in plain sight as the "messages keep moving after the skeleton
  // reveal" jolt. For the same 6s settle window, keep the jump target glued
  // to its revealed position using the SAME exact-DOM alignment the reveal
  // gate used (live composer inset, 2px epsilon no-op), so any late reflow is
  // absorbed invisibly instead of extending the skeleton (which historically
  // caused multi-second blank chats). Retires on the first real user scroll
  // gesture — it must never fight someone scrolling away from the target.
  useEffect(() => {
    if (!initialRevealReady) return;
    const anchor = postJumpAnchorRef.current;
    if (!anchor) return;
    if (typeof ResizeObserver === "undefined") return;
    const viewport = scrollerElRef.current;
    if (!viewport) return;
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (!inner) return;

    // Same window as STAY_PINNED_MS so late-hydrating read receipts are
    // compensated before the guard retires.
    const ANCHOR_WINDOW_MS = 6000;
    const retireAt = anchor.at + ANCHOR_WINDOW_MS;
    const remaining = retireAt - performance.now();
    if (remaining <= 0) return;

    let cancelled = false;
    let lastSignature = "";
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const retire = () => {
      if (cancelled) return;
      cancelled = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.clearTimeout(stopTimer);
    };

    const reanchor = () => {
      if (cancelled) return;
      if (performance.now() > retireAt) {
        retire();
        return;
      }
      // Hard guards: never re-align from an observer callback while the user
      // is actively scrolling or has scrolled away from the revealed target.
      if (isViewportUserActive(viewport)) {
        retire();
        return;
      }
      if (userHasScrolledAfterPinRef.current) {
        retire();
        return;
      }
      // Geometry-signature gate: mutation noise that doesn't move anything
      // (class flips, text ticks) must not even run the DOM measurement.
      const signature = `${Math.round(viewport.scrollTop)}:${Math.round(viewport.scrollHeight)}:${Math.round(viewport.clientHeight)}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      // alignMessageIdInView is idempotent here: live composer inset, 2px
      // epsilon no-op, and a single synchronous write — no intermediate paint.
      alignMessageIdInViewRef.current?.(anchor.id, "end");
    };

    resizeObserver = new ResizeObserver(reanchor);
    resizeObserver.observe(viewport);
    resizeObserver.observe(inner);
    mutationObserver = new MutationObserver(reanchor);
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const stopTimer = window.setTimeout(retire, remaining + 50);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.clearTimeout(stopTimer);
    };
  }, [initialRevealReady, jumpAnchorNonce]);


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
    // PREPEND GUARD: when lastMessageId is unchanged but length grew, an
    // older page just landed (Load More / startReached). This is ALWAYS a
    // prepend — never re-pin to LAST regardless of atBottomRef, because the
    // 120px atBottomThreshold keeps atBottomRef=true for the first ~120px
    // of an upward fling. Without this, a fast scroll-up from the bottom
    // that triggers startReached snaps the viewport back to LAST mid-fling
    // (the reported "I scroll up fast and it pins me back to bottom" bug,
    // especially visible in DMs where new realtime messages keep the
    // OPEN_PIN_WINDOW alive).
    if (
      messagesLengthChanged &&
      previousLastMessageId === lastMessageId
    ) return;

    const run = () => {
      const viewport = scrollerElRef.current;
      if (!viewport) return;
      if (isChatJumpActive()) return;
      if (isViewportUserActive(viewport)) return;
      // Pure pixel-distance gate (atBottomRef has a 120px threshold and is
      // unreliable mid-fling — see RO guard above).
      const distanceFromBottom =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (distanceFromBottom > 4) return;
      if (userHasScrolledAfterPinRef.current && distanceFromBottom > 4) return;
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

  // OWN-MESSAGE SEND PIN. When the newest appended message belongs to the
  // current user, they just hit Send — the freshly sent bubble MUST be
  // visible regardless of `followOutput`'s atBottom state, the open-pin
  // window, or a stale jump flag. With the keyboard open Virtuoso often
  // reports atBottom=false (the visual viewport shrank under it), so
  // `followOutput` silently skips the append and the sent bubble lands
  // clipped behind the composer. The page-level `onMutate` scrollToBottom
  // can also be swallowed when `isChatJumpActive()` was left set — sending
  // a message is an explicit intent change, so release the jump and pin.
  const prevOwnPinLastIdRef = useRef<string | null>(lastMessageId);
  useLayoutEffect(() => {
    const prevId = prevOwnPinLastIdRef.current;
    prevOwnPinLastIdRef.current = lastMessageId;
    if (!lastMessageId || lastMessageId === prevId) return;
    const last = messages[messages.length - 1] as { author_id?: string | null } | undefined;
    if (!currentUserId || !last || last.author_id !== currentUserId) return;
    if (isChatJumpActive()) setChatJumpActive(false);

    const pin = () => {
      const el = scrollerElRef.current;
      if (!el) return;
      // NOTE: do NOT bail on `isViewportTouching` here. On Android, sending a
      // message keeps the soft keyboard open and the composer/viewport keeps
      // resizing for several hundred ms after send; any of those resize
      // gestures can leave the touch-tracker hot and silently swallow the
      // pin, leaving the freshly-sent bubble clipped behind the composer.
      // Send is an explicit intent change, so always honour it.
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - maxTop) > 1) {
        el.scrollTop = maxTop;
        markChatScrollWrite();
      }
    };
    pin();
    const r = requestAnimationFrame(() => requestAnimationFrame(pin));
    // Trailing passes absorb composer collapse (reply pill clears, textarea
    // shrinks back to one line), optimistic bubble height settling, and on
    // Android the soft-keyboard / visualViewport reflow that can land 600ms+
    // after send commits.
    const timers = [80, 200, 360, 560, 820, 1200].map((delay) => window.setTimeout(pin, delay));
    return () => {
      cancelAnimationFrame(r);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [lastMessageId, messages, currentUserId]);


  // Only auto-follow new outgoing messages when the user is already at the
  // bottom — never yank a finger reading history.
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? ("auto" as const) : false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior = "auto", options) => {
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
          const viewport = scrollerElRef.current;
          if (options?.force ? isViewportTouching(viewport) : isViewportUserActive(viewport)) return;
          // NOTE: do NOT pass `offset` here. The bottomPadding is already
          // rendered as Virtuoso's Footer inside the list, so it already
          // reserves the composer space above the scroll viewport bottom.
          // Passing offset would apply the composer padding twice and push
          // the last message (and the composer's visual baseline) high up
          // the screen.
          //
          // Single synchronous write to TRUE max scrollTop — no
          // `scrollToIndex(LAST, end)` intermediate frame. The end-align
          // position parks the last row footer-height (32px) above true
          // bottom, so a scrollToIndex-then-maxTop sequence painted two
          // different bottoms a frame apart (the "thread moves up and down
          // after reveal" bounce). pinToTrueBottom is the single canonical
          // target shared by every bottom-pin writer.
          pinToTrueBottom("imperative-scroll-to-bottom", behavior);
        };
        run();
        requestAnimationFrame(() => requestAnimationFrame(run));
        // Trailing re-pins. Each is independently guarded so an active
        // user gesture (finger drag / momentum) cancels them.
        window.setTimeout(run, 200);
        window.setTimeout(run, 400);
        window.setTimeout(run, 650);
      },

      scrollToIndex: (index, align = "center") => {
        if (messagesLengthRef.current <= 0) return;
        const last = Math.max(0, messagesLengthRef.current - 1);
        const dataIndex = Math.max(0, Math.min(index, last));
        const offset = align === "end" && dataIndex !== last ? getChatBottomPaddingOffset(bottomPadding) : 0;
        // `scrollToIndex` expects the zero-based DATA index even when
        // `firstItemIndex` is used for reverse/prepend anchoring. Passing the
        // shifted absolute index gets clamped by Virtuoso to LAST, which is why
        // notification jumps highlighted the right row but kept the viewport at
        // the bottom of the committee chat.
        safeScrollToIndex({
          index: dataIndex,
          align,
          offset,
          behavior: "auto",
        }, "imperative-scroll-to-index");
      },
      scrollToMessageId: (messageId, align = "center") => alignMessageIdInView(messageId, align),

      isAtBottom: () => atBottomRef.current,
      isNearBottom: (thresholdPx: number) => {
        const el = scrollerElRef.current;
        if (!el) return true;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distance <= Math.max(0, thresholdPx);
      },
    }),
    [bottomPadding, safeScrollToIndex, alignMessageIdInView],
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

  // Pre-decode aspect ratios for any image messages in the current window
  // BEFORE Virtuoso mounts those rows. Populates chatImageAspectCache so
  // estimateChatRowHeight reserves the correct box on first paint instead
  // of the 4:3 fallback — eliminates the post-decode row-grow/shrink jolt
  // that telemetry shows as ±50-200px image-row deltas after scroll-up.
  useEffect(() => {
    for (const m of uniqueMessages) {
      const url = (m as any).image_url ?? (m as any).imageUrl ?? null;
      if (url) prefetchChatImageAspectRatio(url);
    }
  }, [uniqueMessages]);


  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => {
      const idx = indexByIdRef.current.get(message.id) ?? -1;
      const rows = uniqueMessagesRef.current;
      const signature = chatRowSignature(message, idx, rows, currentUserIdRef.current);
      return (
        <ChatRowAdapter
          message={message}
          signature={signature}
          renderItemRef={renderItemRef as React.MutableRefObject<
            (m: any, i: number, a: any[]) => React.ReactNode
          >}
          uniqueMessagesRef={uniqueMessagesRef as React.MutableRefObject<any[]>}
          indexByIdRef={indexByIdRef}
          currentUserIdRef={currentUserIdRef}
        />
      );
    },
    [],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);

  const initialTargetIndex = initialTargetMessageId
    ? uniqueMessages.findIndex((message) => message.id === initialTargetMessageId)
    : -1;


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
  // Seed from the module-level flag so push-notification jumps that fire
  // `setChatJumpActive(true)` BEFORE this list mounts still show the
  // overlay (the CustomEvent itself would have been dispatched before our
  // listener was attached and silently lost).
  const [isJumpHydrating, setIsJumpHydrating] = useState(() => isChatJumpActive());
  // Keep the skeleton mounted (with opacity 0) for the duration of its
  // CSS fade-out transition, so a deep-link landing reads as "load → settled"
  // instead of "load → bobble → snap" when the overlay disappears.
  const [renderJumpOverlay, setRenderJumpOverlay] = useState(() => isChatJumpActive());
  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let unmountTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelSettleWait: (() => void) | null = null;
    let hardTimer: number | null = null;
    // Overlay lifecycle budget, anchored at the START of each jump (i.e. each
    // notification/deep-link), never extended by rerenders or by repeated
    // settle passes. SAFETY backstop only — the overlay's normal exit is the
    // settle-driven `onEnd` path, so the reveal always shows a settled thread.
    // Longer than the jump poller's own lifetime (~30s) on purpose.
    const OVERLAY_HARD_DEADLINE_MS = 32000;
    // Shortest defensible fail-safe for the reveal itself. The 32 s value above
    // stays as the absolute never-blank-forever backstop.
    const OVERLAY_REVEAL_FAILSAFE_MS = 4000;
    let hydrating = false;
    const remainingBudget = () =>
      Math.max(0, chatJumpLifecycleRemaining(OVERLAY_HARD_DEADLINE_MS));

    const onStart = () => {
      // Idempotent: duplicate start signals (the CustomEvent AND the
      // `setChatJumpActive(true)` subscription both fire for one jump, plus the
      // seeded mount call) must not re-arm the budget or restart the wait.
      if (hydrating) return;
      hydrating = true;
      if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
      if (unmountTimer) { clearTimeout(unmountTimer); unmountTimer = null; }
      if (cancelSettleWait) { cancelSettleWait(); cancelSettleWait = null; }
      if (hardTimer !== null) { window.clearTimeout(hardTimer); hardTimer = null; }
      hardTimer = window.setTimeout(() => {
        hardTimer = null;
        if (cancelSettleWait) { cancelSettleWait(); cancelSettleWait = null; }
        fadeOut();
      }, OVERLAY_HARD_DEADLINE_MS);
      setRenderJumpOverlay(true);
      setIsJumpHydrating(true);
      // Start observing alignment progress DURING the jump instead of waiting
      // for the tail release and then starting a second, independent settle
      // wait. As soon as the exact target is mounted, aligned above the
      // composer and stationary for a short quiet window we fade out — which is
      // what removed the multi-second blank chat after a notification tap.
      armRevealWait();
    };
    const fadeOut = () => {
      if (hardTimer !== null) { window.clearTimeout(hardTimer); hardTimer = null; }
      hydrating = false;
      setIsJumpHydrating(false);
      if (unmountTimer) clearTimeout(unmountTimer);
      unmountTimer = setTimeout(() => setRenderJumpOverlay(false), 300);
    };
    function armRevealWait() {
      const scroller = scrollerElRef.current;
      const budget = remainingBudget();
      if (!scroller || budget <= 200) {
        if (fadeTimer) clearTimeout(fadeTimer);
        fadeTimer = setTimeout(fadeOut, 120);
        return;
      }
      const targetId =
        getChatJumpLifecycle().targetMessageId ?? jumpOverlayTargetRef.current;
      cancelSettleWait = waitForChatJumpTargetReveal(
        scroller,
        {
          targetMessageId: targetId,
          usableBottomInsetPx: getChatBottomPaddingOffset(bottomPaddingRef.current),
          quietMs: 240,
          budgetMs: Math.max(
            600,
            Math.min(OVERLAY_REVEAL_FAILSAFE_MS, budget),
          ),
          finalAlign: () => {
            // Single alignment authority: while the content-reveal gate owns
            // this target, its own `finalAlign` is the only one allowed to
            // write scrollTop. Two gates correcting the same row on different
            // frames is what produced the down-then-up settle.
            if (!targetId) return;
            if (jumpAlignOwnedByContentGateRef.current === targetId) return;
            alignMessageIdInViewRef.current?.(targetId, "end");
          },
        },
        () => {
          cancelSettleWait = null;
          // Tiny intentional cross-fade so the reveal reads as "settled".
          if (fadeTimer) clearTimeout(fadeTimer);
          // Hold the overlay a little longer while the composer inset (and thus
          // the in-flow Virtuoso footer height) is still changing.
          const delay = bottomPaddingQuiet(180) ? 80 : 220;
          fadeTimer = setTimeout(fadeOut, delay);
        },

      );
    }
    const onEnd = () => {
      // Idempotent by construction: the reveal wait is already running from
      // `onStart`, so duplicate `chat:jump-hydration-end` /
      // `setChatJumpActive(false)` notifications must NOT cancel or restart it.
      if (!hydrating) return;
      if (cancelSettleWait) return;
      armRevealWait();
    };

    window.addEventListener("chat:jump-hydration-start", onStart);
    window.addEventListener("chat:jump-hydration-end", onEnd);
    const unsubscribe = subscribeChatJumpActive((value) => {
      if (value) onStart();
      else onEnd();
    });
    // Jump was already active before this list mounted (cold push tap): the
    // start event was dispatched before our listener existed, so arm the
    // lifecycle budget now — otherwise the seeded overlay would have no
    // deadline at all.
    if (isChatJumpActive()) onStart();
    return () => {
      window.removeEventListener("chat:jump-hydration-start", onStart);
      window.removeEventListener("chat:jump-hydration-end", onEnd);
      unsubscribe();
      if (fadeTimer) clearTimeout(fadeTimer);
      if (unmountTimer) clearTimeout(unmountTimer);
      if (hardTimer !== null) window.clearTimeout(hardTimer);
      if (cancelSettleWait) cancelSettleWait();
    };
  }, []);



  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
      }}
    >
    {!initialRevealReady ? <JumpHydrationSkeleton /> : null}
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        opacity: initialRevealReady ? 1 : 0,
        transition: initialRevealReady ? "opacity 80ms ease-out" : "none",
      }}
    >
    {uniqueMessages.length > 0 ? (
      <Virtuoso
      ref={virtuosoRef}
      className={className}
      style={{ height: "100%", ...style, overflowAnchor: "none" }}
      data={uniqueMessages}
      firstItemIndex={firstItemIndex}
      // When a deep-link target message id is supplied but isn't in the current
      // message window yet (typical first paint from a push notification — the
      // parent's jump-window hydration query runs async, or silently fails on
      // RLS/network), fall back to anchoring at the latest message instead of
      // leaving Virtuoso unanchored (which can present as a completely blank
      // viewport on Android WebView). Once the hydration completes, the parent
      // bumps its scrollerKey and we remount with a valid `initialTargetIndex`.
      initialTopMostItemIndex={
        // Guard: Virtuoso crashes with "Cannot read properties of undefined
        // (reading 'index')" if we hand it an initial anchor while `data` is
        // still empty — its internal sizer tries to read items[-1].index.
        // This is exactly the cold-start path for a notification tap on
        // team/club chats, where uniqueMessages is briefly [] before the
        // first query resolves. Skip the prop until we actually have rows.
        uniqueMessages.length === 0
          ? undefined
          : initialTargetIndex >= 0
            ? { index: initialTargetIndex, align: "end", behavior: "auto" }
            : (initialBottomPinned || !!initialTargetMessageId)
              ? { index: "LAST", align: "end", behavior: "auto" }
              : undefined
      }
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
      isScrolling={handleIsScrollingChange}
      followOutput={initialBottomPinned ? followOutput : false}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      itemSize={itemSize}
      // ROOT-CAUSE FIX for scroll-up flicker/movement: by default Virtuoso
      // wraps its item ResizeObserver callback in requestAnimationFrame, so a
      // row mounted during upward scroll reports its real height ONE FRAME
      // LATE. For that frame the list is positioned with the wrong (default
      // 160px) height, then snaps — visible as per-row flicker on slow scroll
      // and compounding viewport movement on fast flings (react-virtuoso
      // issue #1049). Skipping the rAF makes measurement synchronous within
      // the same layout pass, eliminating the one-frame misposition window.
      // Note: estimator tuning could never fix this — estimateChatRowHeight
      // only feeds debug telemetry; Virtuoso itself only knows
      // defaultItemHeight until the RO reports.
      skipAnimationFrameInResizeObserver
      // Tuned to the real median chat row height: most rows fall in the
      // 90–180px band (text bubble + author + timestamp ≈ 90, image rows
      // with the reserved 4/3 frame ≈ 300). 160 is the population median
      // and minimises the magnitude of the post-measure correction Virtuoso
      // applies to unmeasured rows during a fast upward fling.
      defaultItemHeight={160}
      scrollSeekConfiguration={false}
      // ROOT-CAUSE FIX (round 13): estimateChatRowHeight / chatRowHeightCache
      // never feed Virtuoso — the library only knows defaultItemHeight (160)
      // for unmounted rows and corrects on first mount. On Android touch
      // scrolling that correction is a scrollTop write mid-fling = the
      // visible flicker (slow scroll) and post-stop jolt (fast fling). No
      // estimator tuning can remove it. The only way to eliminate it is to
      // guarantee rows are mounted + measured BEFORE they can reach the
      // viewport: keep the top overscan larger than one full message page
      // (30 rows ≈ 4800px at the 160px default), so the entire loaded window
      // mounts at reveal and each prepended page mounts in ONE batch at the
      // scroll-idle commit. After that batch, scrolling through those rows
      // performs zero corrections. Hydration no longer trickles in mid-fling
      // because nothing mounts mid-fling.
      increaseViewportBy={{ top: 6000, bottom: 600 }}
      minOverscanItemCount={{ top: 8, bottom: 2 }}
      atBottomThreshold={120}
      scrollerRef={wrappedScrollerRef}
      context={virtuosoContext}
      components={components as any}
      />
    ) : null}
    {renderJumpOverlay ? <JumpHydrationSkeleton visible={isJumpHydrating} /> : null}
    </div>
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
