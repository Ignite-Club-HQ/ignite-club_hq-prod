import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getChatScrollMetrics, resolveChatScrollViewport, scrollChatToBottom } from "@/lib/chatScroll";

interface UseInitialChatBottomPinOptions {
  scrollContainerRef: RefObject<HTMLElement>;
  bottomAnchorRef?: RefObject<HTMLElement>;
  itemCount: number;
  resetKey?: string | number | null;
  enabled?: boolean;
  onPinned?: () => void;
}

/**
 * Pins a chat scroll container to the bottom on initial load.
 *
 * Strategy: wait for content to appear and layout to stabilise (quiet for 80ms),
 * then snap once and reveal. Once the user scrolls away from the bottom, all
 * automatic snapping is suppressed until the next navigation (resetKey change).
 */
export function useInitialChatBottomPin({
  scrollContainerRef,
  bottomAnchorRef,
  itemCount,
  resetKey,
  enabled = true,
  onPinned,
}: UseInitialChatBottomPinOptions) {
  const pinnedKeyRef = useRef<string | number | null | undefined>(undefined);
  const onPinnedRef = useRef(onPinned);
  const [isPinned, setIsPinned] = useState(false);
  // Track if we "pinned" due to empty content so we can re-pin when data arrives
  const pinnedWhileEmptyRef = useRef(false);
  // Once the user scrolls away from bottom, suppress all automatic snapping
  const userScrolledAwayRef = useRef(false);
  // Track last known item count per resetKey so we can re-snap when fresh
  // network data arrives after the initial cached render (iOS cold start).
  const lastItemCountRef = useRef(0);
  // Timestamp of the most recent successful pin. Used to distinguish "late
  // server data settling" (within the post-pin window) from genuine user
  // scrolling away after the chat has stabilised.
  const pinnedAtRef = useRef(0);
  // Threshold (px) at which we consider the user has intentionally scrolled
  // away from the bottom. Generous to avoid tripping on layout/content jumps
  // when fresh server data appends new messages after the cached render.
  const USER_SCROLL_AWAY_THRESHOLD_PX = 400;
  const POST_PIN_TRUST_WINDOW_MS = 3500;

  useEffect(() => {
    onPinnedRef.current = onPinned;
  }, [onPinned]);

  // Reset the user-scrolled flag whenever the chat changes
  useEffect(() => {
    userScrolledAwayRef.current = false;
    lastItemCountRef.current = 0;
    pinnedAtRef.current = 0;
  }, [resetKey]);

  // Detect manual scrolling away from bottom to suppress auto-snap
  useEffect(() => {
    if (!isPinned) return;

    const viewport = resolveChatScrollViewport(scrollContainerRef.current);
    if (!viewport) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        // Don't trust scroll events fired within the post-pin settle window —
        // they're almost always layout shifts (image loads, late messages,
        // composer resizes), not real user intent.
        if (performance.now() - pinnedAtRef.current < POST_PIN_TRUST_WINDOW_MS) return;
        const metrics = getChatScrollMetrics(scrollContainerRef.current);
        if (metrics && metrics.distanceFromBottom > USER_SCROLL_AWAY_THRESHOLD_PX) {
          userScrolledAwayRef.current = true;
        }
      });
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [isPinned, scrollContainerRef, resetKey]);

  useLayoutEffect(() => {
    if (!enabled) {
      setIsPinned(true);
      return;
    }

    if (pinnedKeyRef.current === resetKey) {
      const grew = itemCount > lastItemCountRef.current;
      const wasEmptyPin = pinnedWhileEmptyRef.current && itemCount > 0;

      if (wasEmptyPin) {
        // Messages arrived AFTER we declared an empty-pin (e.g. first open
        // post-login while auth was still resolving). Re-run the full pin
        // sequence so we get settle attempts + post-pin guard with image
        // load listeners — same robustness as the initial open path.
        // CRITICAL: clear userScrolledAwayRef. During the empty-pin phase the
        // scroll listener was active (isPinned=true) but pinnedAtRef was 0,
        // so any scroll event from content streaming into the empty viewport
        // fell outside the trust window and falsely marked the user as
        // scrolled-away. Without resetting it here, every post-pin guard
        // (ResizeObserver, image-load, delayed snaps) below short-circuits
        // and late profile/image hydration leaves the user above bottom.
        userScrolledAwayRef.current = false;
        pinnedWhileEmptyRef.current = false;
        lastItemCountRef.current = itemCount;
        // Reset so the main effect re-runs on the next render via dependency
        // change. We invalidate the pinned key to force a fresh pin pass.
        pinnedKeyRef.current = undefined;
        setIsPinned(false);
        // Fall through to the main pin sequence below.
      } else if (grew && !userScrolledAwayRef.current) {
        // Within the post-pin settle window, growth is almost certainly late
        // server data (cached render → fresh fetch appended newer messages,
        // images loading, profile hydration causing re-render). Trust the
        // prior pin intent and snap forward — don't gate on current
        // distanceFromBottom, which is misleading during layout settling.
        const withinSettleWindow =
          performance.now() - pinnedAtRef.current < POST_PIN_TRUST_WINDOW_MS;

        if (!withinSettleWindow) {
          // After the settle window, only re-snap if the user is genuinely
          // near the bottom. Use the same generous threshold as the scroll
          // listener so a single content-height jump doesn't trip us.
          const growMetrics = getChatScrollMetrics(scrollContainerRef.current);
          const userNearBottom =
            !growMetrics || growMetrics.distanceFromBottom <= USER_SCROLL_AWAY_THRESHOLD_PX;
          if (!userNearBottom) {
            userScrolledAwayRef.current = true;
            lastItemCountRef.current = itemCount;
            return;
          }
        }

        lastItemCountRef.current = itemCount;
        scrollChatToBottom(scrollContainerRef.current);
        requestAnimationFrame(() => {
          scrollChatToBottom(scrollContainerRef.current);
          requestAnimationFrame(() => {
            scrollChatToBottom(scrollContainerRef.current);
          });
        });

        // Brief resize guard — only snap if user hasn't scrolled away
        const viewport = resolveChatScrollViewport(scrollContainerRef.current);
        if (viewport && typeof ResizeObserver !== "undefined") {
          const guardObserver = new ResizeObserver(() => {
            if (!userScrolledAwayRef.current) {
              const m = getChatScrollMetrics(scrollContainerRef.current);
              if (m && m.distanceFromBottom > USER_SCROLL_AWAY_THRESHOLD_PX) {
                userScrolledAwayRef.current = true;
                return;
              }
              scrollChatToBottom(scrollContainerRef.current);
            }
          });
          guardObserver.observe(viewport);
          setTimeout(() => guardObserver.disconnect(), 1000);
        }
        return;
      } else {
        lastItemCountRef.current = itemCount;
        return;
      }
    }

    if (itemCount <= 0) {
      pinnedWhileEmptyRef.current = true;
      setIsPinned(true);
      pinnedKeyRef.current = resetKey;
      lastItemCountRef.current = 0;
      return;
    }

    pinnedWhileEmptyRef.current = false;
    lastItemCountRef.current = itemCount;
    setIsPinned(false);

    let cancelled = false;
    let finalizing = false;
    let observer: MutationObserver | null = null;
    let mountObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let postPinResizeObserver: ResizeObserver | null = null;
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let postPinTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId = 0;
    const STABILITY_MS = 100;
    const MAX_WAIT_MS = 1500;
    const POST_PIN_GUARD_MS = 3500;
    const BOTTOM_THRESHOLD_PX = 2;
    const MAX_SETTLE_ATTEMPTS = 8;

    const cleanup = () => {
      observer?.disconnect();
      mountObserver?.disconnect();
      resizeObserver?.disconnect();
      postPinResizeObserver?.disconnect();
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (postPinTimer) clearTimeout(postPinTimer);
      cancelAnimationFrame(rafId);
    };

    const guardSnap = () => {
      if (cancelled || userScrolledAwayRef.current) return;
      const metrics = getChatScrollMetrics(scrollContainerRef.current);
      // During the post-pin trust window, the user cannot have scrolled
      // (the scroll listener ignores events for POST_PIN_TRUST_WINDOW_MS).
      // Any drift is layout settling — late profile data, avatars decoding,
      // composer height stabilising — which on Team/Group chats can easily
      // exceed 400px. ALWAYS re-snap during this window.
      const withinTrustWindow =
        performance.now() - pinnedAtRef.current < POST_PIN_TRUST_WINDOW_MS;
      if (!withinTrustWindow && metrics && metrics.distanceFromBottom > USER_SCROLL_AWAY_THRESHOLD_PX) {
        userScrolledAwayRef.current = true;
        return;
      }
      scrollChatToBottom(scrollContainerRef.current);
    };

    const startPostPinGuard = () => {
      if (cancelled) return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      // Watch for size changes on BOTH the viewport (e.g. keyboard opens) and
      // the inner content (e.g. composer height changes that grow padding-bottom,
      // images loading, late-rendered messages). Without observing the inner
      // content, dynamic padding-bottom changes after reveal would push content
      // up and leave the user above the bottom.
      postPinResizeObserver?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        postPinResizeObserver = new ResizeObserver(() => guardSnap());
        postPinResizeObserver.observe(viewport);

        const innerContent = viewport.firstElementChild;
        if (innerContent instanceof HTMLElement) {
          postPinResizeObserver.observe(innerContent);
        }
      }

      // Re-snap whenever an image inside the viewport finishes loading.
      // Without this, late-loading attachments push content down AFTER
      // we've revealed the chat, leaving the user above the bottom.
      const imageListeners: Array<{ img: HTMLImageElement; handler: () => void }> = [];
      const attachImageListeners = () => {
        const images = viewport.querySelectorAll<HTMLImageElement>("img");
        images.forEach((img) => {
          if (img.complete && img.naturalHeight > 0) return;
          if (imageListeners.some((entry) => entry.img === img)) return;
          const handler = () => {
            if (cancelled || userScrolledAwayRef.current) return;
            scrollChatToBottom(scrollContainerRef.current);
          };
          img.addEventListener("load", handler, { once: true });
          img.addEventListener("error", handler, { once: true });
          imageListeners.push({ img, handler });
        });
      };
      attachImageListeners();

      // Watch for newly added images (e.g. lazy-rendered messages)
      const imageMountObserver = new MutationObserver(() => {
        if (cancelled || userScrolledAwayRef.current) return;
        attachImageListeners();
      });
      imageMountObserver.observe(viewport, { childList: true, subtree: true });

      guardSnap();
      // Belt-and-braces: schedule unconditional snaps across the full settle
      // window to catch late layout shifts that can sneak past the
      // ResizeObserver / image-load listeners — most commonly the composer
      // measuring its real height after first paint, and signed-URL images
      // mounting their <img> tags only after their URL resolves. Without
      // these, the user sees the chat correctly pinned to bottom on open
      // and then watches it shift upward "at the last second".
      const delayedSnapTimers = [80, 240, 500, 900, 1500, 2400].map((delay) =>
        setTimeout(() => {
          if (cancelled || userScrolledAwayRef.current) return;
          const m = getChatScrollMetrics(scrollContainerRef.current);
          if (!m) return;
          const withinTrustWindow =
            performance.now() - pinnedAtRef.current < POST_PIN_TRUST_WINDOW_MS;
          if (!withinTrustWindow && m.distanceFromBottom > USER_SCROLL_AWAY_THRESHOLD_PX) return;
          // Skip when already pinned to bottom — re-snapping triggers layout
          // reads that on iOS WKWebView can interrupt rubber-band/inertia and
          // produce the "bounce on open" the user reported. Only correct
          // genuine drift (late image loads, composer height settling).
          if (m.distanceFromBottom <= 1) return;
          scrollChatToBottom(scrollContainerRef.current);
        }, delay),
      );
      postPinTimer = setTimeout(() => {
        postPinResizeObserver?.disconnect();
        postPinResizeObserver = null;
        imageMountObserver.disconnect();
        imageListeners.forEach(({ img, handler }) => {
          img.removeEventListener("load", handler);
          img.removeEventListener("error", handler);
        });
        imageListeners.length = 0;
        delayedSnapTimers.forEach(clearTimeout);
      }, POST_PIN_GUARD_MS);
    };

    const reveal = () => {
      pinnedKeyRef.current = resetKey;
      pinnedAtRef.current = performance.now();
      setIsPinned(true);
      startPostPinGuard();
      onPinnedRef.current?.();
    };

    const settleAtBottom = (attemptsLeft = MAX_SETTLE_ATTEMPTS) => {
      if (cancelled) return;

      scrollChatToBottom(scrollContainerRef.current);
      rafId = requestAnimationFrame(() => {
        if (cancelled) return;

        scrollChatToBottom(scrollContainerRef.current);
        const firstMetrics = getChatScrollMetrics(scrollContainerRef.current);

        rafId = requestAnimationFrame(() => {
          if (cancelled) return;

          scrollChatToBottom(scrollContainerRef.current);
          const secondMetrics = getChatScrollMetrics(scrollContainerRef.current);
          const firstSettled = !firstMetrics || firstMetrics.distanceFromBottom <= BOTTOM_THRESHOLD_PX;
          const secondSettled = !secondMetrics || secondMetrics.distanceFromBottom <= BOTTOM_THRESHOLD_PX;

          if ((!firstSettled || !secondSettled) && attemptsLeft > 0) {
            settleAtBottom(attemptsLeft - 1);
            return;
          }

          reveal();
        });
      });
    };

    const finalize = () => {
      if (cancelled || finalizing) return;
      finalizing = true;
      cleanup();
      settleAtBottom();
    };

    const scheduleFinalize = () => {
      if (cancelled || finalizing) return;
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(finalize, STABILITY_MS);
    };

    const attachToViewport = () => {
      if (cancelled) return false;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return false;

      observer?.disconnect();
      observer = new MutationObserver(() => {
        if (cancelled || finalizing) return;
        const vp = resolveChatScrollViewport(scrollContainerRef.current);
        if (vp) vp.scrollTop = vp.scrollHeight - vp.clientHeight;
        scheduleFinalize();
      });
      observer.observe(viewport, { childList: true, subtree: true, characterData: true });

      resizeObserver?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (cancelled || finalizing) return;
          const vp = resolveChatScrollViewport(scrollContainerRef.current);
          if (vp) vp.scrollTop = vp.scrollHeight - vp.clientHeight;
          scheduleFinalize();
        });

        resizeObserver.observe(viewport);

        const contentTarget =
          bottomAnchorRef?.current?.parentElement ??
          viewport.firstElementChild ??
          viewport;

        if (contentTarget instanceof HTMLElement && contentTarget !== viewport) {
          resizeObserver.observe(contentTarget);
        }
      }

      scheduleFinalize();
      return true;
    };

    if (!attachToViewport()) {
      const root = scrollContainerRef.current?.parentElement ?? document.body;
      mountObserver = new MutationObserver(() => {
        if (attachToViewport()) {
          mountObserver?.disconnect();
        }
      });
      mountObserver.observe(root, { childList: true, subtree: true });

      const retry = () => {
        if (cancelled) return;
        if (!attachToViewport()) {
          rafId = requestAnimationFrame(retry);
        }
      };
      rafId = requestAnimationFrame(retry);
    }

    maxTimer = setTimeout(() => {
      if (cancelled) return;
      finalize();
    }, MAX_WAIT_MS);

    return () => {
      cancelled = true;
      cleanup();
      if (pinnedKeyRef.current !== resetKey) {
        setIsPinned(true);
      }
    };
  }, [bottomAnchorRef, enabled, itemCount, resetKey, scrollContainerRef]);

  // On resume: snap to bottom only if user was already near bottom.
  // Uses a short observation window instead of aggressive polling.
  useEffect(() => {
    if (!isPinned) return;

    let wasNearBottom = true;
    let observer: MutationObserver | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        const viewport = resolveChatScrollViewport(scrollContainerRef.current);
        if (viewport) {
          const maxScroll = viewport.scrollHeight - viewport.clientHeight;
          wasNearBottom = maxScroll - viewport.scrollTop < 150;
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !wasNearBottom || userScrolledAwayRef.current) return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      scrollChatToBottom(scrollContainerRef.current);

      observer?.disconnect();
      observer = new MutationObserver(() => {
        if (!userScrolledAwayRef.current) {
          scrollChatToBottom(scrollContainerRef.current);
        }
      });
      observer.observe(viewport, { childList: true, subtree: true });

      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        observer?.disconnect();
        observer = null;
        if (!userScrolledAwayRef.current) {
          requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));
        }
      }, 1500);
    };

    document.addEventListener("visibilitychange", onHidden);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      observer?.disconnect();
      if (watchdogTimer) clearTimeout(watchdogTimer);
      document.removeEventListener("visibilitychange", onHidden);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isPinned, scrollContainerRef]);

  return { isPinned };
}
