import { useEffect, useRef, useState } from "react";
import { isViewportTouching } from "@/lib/chatScrollIntent";
import { debugLogEvent } from "./chatVirtDebug";

const PREPEND_MOTION_WINDOW_MS = 250;
const PREPEND_INPUT_SESSION_MS = 300;

let flushPendingPrependOnMotion: (() => void) | null = null;
let lastPrependUpwardMotionAt = 0;
let lastPrependInputAt = 0;
let lastPrependScrollStoppedAt = 0;
let prependVirtuosoIsScrolling = false;
let prependScrollSessionIsUserDriven = false;
let prependScroller: (() => HTMLElement | null) | null = null;

export function setDeferredPrependScroller(getScroller: (() => HTMLElement | null) | null) {
  prependScroller = getScroller;
}

export function markDeferredPrependUserInput() {
  if (typeof performance !== "undefined") lastPrependInputAt = performance.now();
}

export function setDeferredPrependScrolling(scrolling: boolean) {
  if (typeof performance === "undefined") return;
  const now = performance.now();
  const scroller = prependScroller?.();
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

export function isDeferredPrependUserScrollActive(): boolean {
  return prependVirtuosoIsScrolling && prependScrollSessionIsUserDriven;
}

function canRecordPrependUpwardMotion(explicitGesture = false) {
  if (explicitGesture) return true;
  const scroller = prependScroller?.();
  if (scroller && isViewportTouching(scroller)) return true;
  return prependVirtuosoIsScrolling && prependScrollSessionIsUserDriven;
}

function isPrependMotionActive() {
  if (typeof performance === "undefined") return false;
  const scroller = prependScroller?.();
  if (scroller && isViewportTouching(scroller)) return true;
  if (!prependVirtuosoIsScrolling || !prependScrollSessionIsUserDriven) return false;
  if (lastPrependScrollStoppedAt >= lastPrependUpwardMotionAt) return false;
  return performance.now() - lastPrependUpwardMotionAt <= PREPEND_MOTION_WINDOW_MS;
}

export function markDeferredPrependUpwardMotion(
  options: { explicitGesture?: boolean } = {},
) {
  if (!canRecordPrependUpwardMotion(options.explicitGesture)) return false;
  if (typeof performance !== "undefined") lastPrependUpwardMotionAt = performance.now();
  flushPendingPrependOnMotion?.();
  return true;
}

/**
 * Holds an older page that arrives after scrolling stops until the next
 * explicit upward gesture. Appends, edits and interleaves remain immediate.
 */
export function useDeferredChatPrepends<TMessage extends { id: string }>(
  messages: TMessage[],
): TMessage[] {
  const [committed, setCommitted] = useState<TMessage[]>(messages);
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
    if (messages === committedRef.current) return;

    const current = committedRef.current;
    const committedIds = new Set(current.map((message) => message.id));
    const newRows = messages.filter((message) => !committedIds.has(message.id));

    if (newRows.length === 0 || current.length === 0) {
      pendingPrependRef.current = null;
      setCommitted(messages);
      return;
    }

    const isPurePrepend = newRows.every((message, index) => messages[index]?.id === message.id);
    if (!isPurePrepend || isPrependMotionActive()) {
      pendingPrependRef.current = null;
      setCommitted(messages);
      return;
    }

    pendingPrependRef.current = messages;
    debugLogEvent("prepend-held-until-motion", { len: messages.length, added: newRows.length });
  }, [messages]);

  return committed;
}
