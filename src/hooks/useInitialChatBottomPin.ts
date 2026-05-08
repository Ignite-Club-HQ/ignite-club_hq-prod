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
  // Short trust window: only swallow scroll events from the pin sequence's
  // own programmatic settle. After this, ANY upward movement is treated as
  // user intent and disables auto-snap. Previously 3500ms — long enough
  // that a user who scrolled up immediately after opening a thread would
  // get yanked back down by delayed snaps / ResizeObserver / image-load
  // re-anchors. That was the "I scroll up and it scrolls back down" bug.
  const POST_PIN_TRUST_WINDOW_MS = 600;
  // Hard upward-movement override: even inside the trust window, a real
  // user-initiated upward drag of more than this many pixels disables
  // auto-snap immediately. Touch flicks easily exceed this.
  const USER_INTENT_UPWARD_PX = 60;

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
    let lastScrollTop = viewport.scrollTop;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const metrics = getChatScrollMetrics(scrollContainerRef.current);
        if (!metrics) return;
        const currentTop = metrics.viewport.scrollTop;
        const movedUpwardPx = lastScrollTop - currentTop;
        lastScrollTop = currentTop;

        const withinTrustWindow =
          performance.now() - pinnedAtRef.current < POST_PIN_TRUST_WINDOW_MS;

        // Inside the trust window we still allow detecting clear user intent:
        // a meaningful upward drag in a single frame is never produced by our
        // own snap-to-bottom (which only ever decreases distanceFromBottom).
        if (withinTrustWindow && movedUpwardPx < USER_INTENT_UPWARD_PX) return;

        if (metrics.distanceFromBottom > USER_SCROLL_AWAY_THRESHOLD_PX || movedUpwardPx >= USER_INTENT_UPWARD_PX) {
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
            // Layout shift handler — never flip userScrolledAwayRef here.
            // Only the real scroll-event listener may decide the user
            // intentionally scrolled. A growth in scrollHeight from late
            // profile/avatar/image hydration is not user intent.
            if (!userScrolledAwayRef.current) {
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
      // CRITICAL: do NOT setIsPinned(true) here. Revealing an empty viewport
      // means the user sees the chat container at scrollTop=0; when messages
      // then stream in (itemCount goes 0 → N), scrollHeight grows from 0 to
      // tall while scrollTop is still 0, so the user briefly sees the TOP of
      // the thread (oldest messages) before the wasEmptyPin branch fires the
      // re-pin sequence and snaps to bottom. That paint-between is the
      // "opened at bottom, jolted up to older messages, settled" jolt the
      // user reported on first-ever thread open. Keep visibility:hidden by
      // leaving isPinned=false until the real pin sequence below completes.
      pinnedWhileEmptyRef.current = true;
      pinnedKeyRef.current = resetKey;
      lastItemCountRef.current = 0;
      pinnedAtRef.current = performance.now();
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
    const POST_PIN_GUARD_MS = 2000;
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
      // Layout-shift snap. Never flip userScrolledAwayRef from here —
      // that flag is reserved for the real scroll-event listener (which
      // already enforces the trust window + USER_SCROLL_AWAY_THRESHOLD_PX).
      // On first-ever open of a thread (no cached profiles/avatars),
      // hydration can grow the content by 600–900px in a single tick;
      // gating on a distance threshold here would permanently disable
      // re-snapping and leave the user above bottom (the "jolt up" bug).
      scrollChatToBottom(scrollContainerRef.current);
    };

    const startPostPinGuard = () => {
      if (cancelled) return;

      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) return;

      // Track whether the user has touched the viewport since reveal. Once
      // they touch the chat, ALL automatic snaps from this guard go silent
      // unless they're still pinned within 1px of bottom. Without this, the
      // ResizeObserver / image-load / delayed-snap chain fights every finger
      // drag for 6s after open — that's the "I scroll up and it jumps back
      // down" jolt the user sees mid-flick.
      let userTouched = false;
      const onTouch = () => { userTouched = true; };
      viewport.addEventListener("touchstart", onTouch, { passive: true, once: true });
      viewport.addEventListener("wheel", onTouch, { passive: true, once: true });

      const safeGuardSnap = () => {
        if (cancelled || userScrolledAwayRef.current) return;
        if (userTouched) {
          // User is interacting — only correct if they're still at the very
          // bottom. Any non-trivial distance means they're scrolling up.
          const m = getChatScrollMetrics(scrollContainerRef.current);
          if (!m || m.distanceFromBottom > 8) return;
        }
        scrollChatToBottom(scrollContainerRef.current);
      };

      // Watch for size changes on BOTH the viewport (e.g. keyboard opens) and
      // the inner content (composer height changes, images, late messages).
      postPinResizeObserver?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        postPinResizeObserver = new ResizeObserver(() => safeGuardSnap());
        postPinResizeObserver.observe(viewport);

        const innerContent = viewport.firstElementChild;
        if (innerContent instanceof HTMLElement) {
          postPinResizeObserver.observe(innerContent);
        }
      }

      // Re-snap whenever an image inside the viewport finishes loading.
      const imageListeners: Array<{ img: HTMLImageElement; handler: () => void }> = [];
      const attachImageListeners = () => {
        const images = viewport.querySelectorAll<HTMLImageElement>("img");
        images.forEach((img) => {
          if (img.complete && img.naturalHeight > 0) return;
          if (imageListeners.some((entry) => entry.img === img)) return;
          const handler = () => safeGuardSnap();
          img.addEventListener("load", handler, { once: true });
          img.addEventListener("error", handler, { once: true });
          imageListeners.push({ img, handler });
        });
      };
      attachImageListeners();

      const imageMountObserver = new MutationObserver(() => {
        if (cancelled || userScrolledAwayRef.current) return;
        attachImageListeners();
      });
      imageMountObserver.observe(viewport, { childList: true, subtree: true });

      safeGuardSnap();
      // Belt-and-braces delayed snaps — also gated by safeGuardSnap so they
      // never override an in-progress user drag.
      const delayedSnapTimers = [80, 240, 500, 900, 1500, 2400, 3500, 5000].map((delay) =>
        setTimeout(() => {
          if (cancelled || userScrolledAwayRef.current) return;
          const m = getChatScrollMetrics(scrollContainerRef.current);
          if (!m) return;
          if (m.distanceFromBottom <= 1) return;
          // After user touch, only correct very small drift — never yank
          // them back from a real scroll.
          if (userTouched && m.distanceFromBottom > 8) return;
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
        viewport.removeEventListener("touchstart", onTouch);
        viewport.removeEventListener("wheel", onTouch);
      }, POST_PIN_GUARD_MS);
    };

    const reveal = () => {
      pinnedKeyRef.current = resetKey;
      pinnedAtRef.current = performance.now();
      setIsPinned(true);
      startPostPinGuard();
      onPinnedRef.current?.();
    };

    // Wait for all currently-mounted images inside the viewport (within
    // a generous lookback above the fold) to finish loading before reveal.
    // This is what prevents the "open at bottom, then jolt up" on first
    // install: avatars and attachment thumbnails hydrate AFTER reveal,
    // growing scrollHeight while scrollTop stays put — re-snapping pulls
    // the viewport down and visible content shifts upward.
    const IMAGE_WAIT_MAX_MS = 600;
    const waitForImages = (done: () => void) => {
      const viewport = resolveChatScrollViewport(scrollContainerRef.current);
      if (!viewport) {
        done();
        return;
      }
      const images = Array.from(viewport.querySelectorAll<HTMLImageElement>("img"));
      const pending = images.filter((img) => !(img.complete && img.naturalHeight > 0));
      if (pending.length === 0) {
        done();
        return;
      }
      let remaining = pending.length;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        pending.forEach((img) => {
          img.removeEventListener("load", onOne);
          img.removeEventListener("error", onOne);
        });
        done();
      };
      const onOne = () => {
        remaining -= 1;
        if (remaining <= 0) finish();
      };
      pending.forEach((img) => {
        img.addEventListener("load", onOne, { once: true });
        img.addEventListener("error", onOne, { once: true });
      });
      // Cap the wait — don't hold the chat hidden indefinitely if a
      // signed URL never resolves.
      setTimeout(finish, IMAGE_WAIT_MAX_MS);
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

          // Final gate: wait for in-flight images to load, snap once more,
          // THEN reveal. This eliminates the post-reveal upward shift.
          waitForImages(() => {
            if (cancelled) return;
            scrollChatToBottom(scrollContainerRef.current);
            requestAnimationFrame(() => {
              if (cancelled) return;
              scrollChatToBottom(scrollContainerRef.current);
              reveal();
            });
          });
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
