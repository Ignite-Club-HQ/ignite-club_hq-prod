import { useLayoutEffect, useRef, type ReactNode } from "react";
import { getLastChatScrollAt, runWhenChatScrollIdle } from "@/lib/chatScrollActivity";
import { setCachedRowHeight } from "./chatRowHeightCache";
import { isAndroidNativeWebView } from "./chatVirtuosoEnvironment";

const MEASUREMENT_IDLE_MS = 600;

/**
 * Cache the real height of a mounted row and refresh it after layout-affecting
 * edits. Android deliberately avoids per-row live ResizeObservers and defers
 * writes until scrolling is idle to protect the WebView compositor.
 */
export function ChatCachedMeasureRow({
  messageId,
  signature,
  children,
}: {
  messageId: string;
  signature: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const write = () => {
      const height = element.offsetHeight;
      if (height > 0) setCachedRowHeight(messageId, height, signatureRef.current);
    };
    write();
    if (isAndroidNativeWebView() || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(write);
    observer.observe(element);
    return () => observer.disconnect();
  }, [messageId]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const write = () => {
      const current = ref.current;
      if (!current) return;
      const height = current.offsetHeight;
      if (height > 0) setCachedRowHeight(messageId, height, signature);
    };
    let cancelIdle: (() => void) | null = null;
    let animationFrame: number | null = null;
    let firstTimer: ReturnType<typeof setTimeout> | null = null;
    let secondTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: ResizeObserver | null = null;
    let observerTimer: ReturnType<typeof setTimeout> | null = null;

    if (isAndroidNativeWebView()) {
      const sinceScroll = performance.now() - getLastChatScrollAt();
      if (sinceScroll >= MEASUREMENT_IDLE_MS) write();
      else cancelIdle = runWhenChatScrollIdle(write, MEASUREMENT_IDLE_MS);
    } else {
      write();
    }

    const writeWhenIdle = () => {
      const sinceScroll = performance.now() - getLastChatScrollAt();
      if (sinceScroll >= MEASUREMENT_IDLE_MS) {
        write();
        return;
      }
      cancelIdle?.();
      cancelIdle = runWhenChatScrollIdle(write, MEASUREMENT_IDLE_MS);
    };

    const scheduleLateWrites = () => {
      animationFrame = requestAnimationFrame(writeWhenIdle);
      firstTimer = setTimeout(writeWhenIdle, 120);
      secondTimer = setTimeout(writeWhenIdle, 360);
      if (isAndroidNativeWebView() || typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(writeWhenIdle);
      observer.observe(element);
      observerTimer = setTimeout(() => {
        observer?.disconnect();
        observer = null;
      }, MEASUREMENT_IDLE_MS);
    };

    const sinceScroll = performance.now() - getLastChatScrollAt();
    if (sinceScroll >= MEASUREMENT_IDLE_MS) scheduleLateWrites();
    else cancelIdle = runWhenChatScrollIdle(scheduleLateWrites, MEASUREMENT_IDLE_MS);

    return () => {
      cancelIdle?.();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (firstTimer) clearTimeout(firstTimer);
      if (secondTimer) clearTimeout(secondTimer);
      if (observerTimer) clearTimeout(observerTimer);
      observer?.disconnect();
    };
  }, [messageId, signature]);

  return <div ref={ref} data-row-id={messageId}>{children}</div>;
}
