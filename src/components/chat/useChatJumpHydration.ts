import { useEffect, useState, type RefObject } from "react";
import { isChatJumpActive, subscribeChatJumpActive } from "@/lib/chatJumpActive";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";

export interface ChatJumpHydrationState {
  isJumpHydrating: boolean;
  renderJumpOverlay: boolean;
}

/** Owns the global jump lifecycle and delays reveal until visible rows settle. */
export function useChatJumpHydration(
  scrollerRef: RefObject<HTMLElement | null>,
): ChatJumpHydrationState {
  const [isJumpHydrating, setIsJumpHydrating] = useState(() => isChatJumpActive());
  const [renderJumpOverlay, setRenderJumpOverlay] = useState(() => isChatJumpActive());

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let unmountTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelSettleWait: (() => void) | null = null;
    let hardTimer: number | null = null;
    const OVERLAY_HARD_DEADLINE_MS = 7000;
    let lifecycleStartedAt = performance.now();
    const remainingBudget = () =>
      Math.max(0, OVERLAY_HARD_DEADLINE_MS - (performance.now() - lifecycleStartedAt));

    const onStart = () => {
      if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
      if (unmountTimer) { clearTimeout(unmountTimer); unmountTimer = null; }
      if (cancelSettleWait) { cancelSettleWait(); cancelSettleWait = null; }
      if (hardTimer !== null) { window.clearTimeout(hardTimer); hardTimer = null; }
      lifecycleStartedAt = performance.now();
      hardTimer = window.setTimeout(() => {
        hardTimer = null;
        if (cancelSettleWait) { cancelSettleWait(); cancelSettleWait = null; }
        fadeOut();
      }, OVERLAY_HARD_DEADLINE_MS);
      setRenderJumpOverlay(true);
      setIsJumpHydrating(true);
    };

    const fadeOut = () => {
      if (hardTimer !== null) { window.clearTimeout(hardTimer); hardTimer = null; }
      setIsJumpHydrating(false);
      if (unmountTimer) clearTimeout(unmountTimer);
      unmountTimer = setTimeout(() => setRenderJumpOverlay(false), 300);
    };

    const onEnd = () => {
      if (fadeTimer) clearTimeout(fadeTimer);
      if (cancelSettleWait) { cancelSettleWait(); cancelSettleWait = null; }
      const scroller = scrollerRef.current;
      const budget = remainingBudget();
      if (scroller && budget > 200) {
        cancelSettleWait = waitForChatVisualContentSettle(
          scroller,
          { quietMs: 650, maxMs: Math.min(8000, budget) },
          () => {
            cancelSettleWait = null;
            fadeTimer = setTimeout(fadeOut, 80);
          },
        );
      } else {
        fadeTimer = setTimeout(fadeOut, 120);
      }
    };

    window.addEventListener("chat:jump-hydration-start", onStart);
    window.addEventListener("chat:jump-hydration-end", onEnd);
    const unsubscribe = subscribeChatJumpActive((value) => {
      if (value) onStart();
      else onEnd();
    });
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
  }, [scrollerRef]);

  return { isJumpHydrating, renderJumpOverlay };
}
