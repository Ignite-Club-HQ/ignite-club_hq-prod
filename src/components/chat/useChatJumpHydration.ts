import { useEffect, useRef, useState, type RefObject } from "react";
import { isChatJumpActive, subscribeChatJumpActive } from "@/lib/chatJumpActive";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";
import { waitForChatJumpTargetReveal } from "@/lib/chatJumpReveal";
import { chatJumpLifecycleRemaining, getChatJumpLifecycle } from "@/lib/chatJumpLifecycle";

export interface ChatJumpHydrationState {
  isJumpHydrating: boolean;
  renderJumpOverlay: boolean;
}

interface ChatJumpHydrationOptions {
  targetMessageId?: string | null;
  usableBottomInsetPx?: number;
  finalAlign?: (targetMessageId: string) => void;
}

/** Owns the global jump lifecycle and delays reveal until visible rows settle. */
export function useChatJumpHydration(
  scrollerRef: RefObject<HTMLElement | null>,
  options: ChatJumpHydrationOptions = {},
): ChatJumpHydrationState {
  const [isJumpHydrating, setIsJumpHydrating] = useState(() => isChatJumpActive());
  const [renderJumpOverlay, setRenderJumpOverlay] = useState(() => isChatJumpActive());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let unmountTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelSettleWait: (() => void) | null = null;
    let hardTimer: number | null = null;
    // Absolute never-blank-forever backstop. Normal release is target-gated
    // and uses the shorter lifecycle budget below.
    const OVERLAY_HARD_DEADLINE_MS = 32000;
    const OVERLAY_REVEAL_FAILSAFE_MS = 4000;
    let hydrating = false;
    let endReceived = false;
    const remainingBudget = (budgetMs: number) =>
      Math.max(0, chatJumpLifecycleRemaining(budgetMs));

    const onStart = () => {
      // The CustomEvent and active-state subscription both signal one jump.
      // Never restart its lifecycle budget or reveal wait. A start received
      // after the matching end is a genuinely newer user action and must
      // supersede the previous fade/wait.
      if (hydrating && !endReceived) return;
      hydrating = true;
      endReceived = false;
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
      armTargetRevealWait();
    };

    const fadeOut = () => {
      if (hardTimer !== null) { window.clearTimeout(hardTimer); hardTimer = null; }
      hydrating = false;
      endReceived = false;
      setIsJumpHydrating(false);
      if (unmountTimer) clearTimeout(unmountTimer);
      unmountTimer = setTimeout(() => setRenderJumpOverlay(false), 300);
    };

    const currentTargetId = () =>
      getChatJumpLifecycle().targetMessageId ?? optionsRef.current.targetMessageId ?? null;

    function armTargetRevealWait() {
      const targetId = currentTargetId();
      const scroller = scrollerRef.current;
      if (!targetId || !scroller) return;
      const budget = remainingBudget(OVERLAY_REVEAL_FAILSAFE_MS);
      cancelSettleWait = waitForChatJumpTargetReveal(
        scroller,
        {
          targetMessageId: targetId,
          usableBottomInsetPx: optionsRef.current.usableBottomInsetPx ?? 0,
          quietMs: 240,
          budgetMs: Math.max(600, budget),
          finalAlign: () => optionsRef.current.finalAlign?.(targetId),
        },
        () => {
          cancelSettleWait = null;
          if (fadeTimer) clearTimeout(fadeTimer);
          fadeTimer = setTimeout(fadeOut, 80);
        },
      );
    }

    const onEnd = () => {
      if (!hydrating) return;
      endReceived = true;
      // Target-aware settling started with the jump and must not be cancelled
      // or restarted by duplicate end signals.
      if (cancelSettleWait) return;
      if (fadeTimer) clearTimeout(fadeTimer);
      const scroller = scrollerRef.current;
      const targetId = currentTargetId();
      if (targetId && scroller) {
        armTargetRevealWait();
        return;
      }
      const budget = remainingBudget(OVERLAY_HARD_DEADLINE_MS);
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
