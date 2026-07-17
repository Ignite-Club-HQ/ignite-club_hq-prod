import { useCallback, useState } from "react";
import type { SubConfirmPayload } from "@/components/scoreboard/SubConfirmDialog";

/**
 * Generic confirmation gate for sub/swap interactions on the pitch boards.
 *
 * Both BasketballBoard and NetballBoard wrap their player/slot handlers with
 * {@link request} — instead of mutating immediately, the handler stages a
 * {@link SubConfirmPayload} (description of the proposed change) and a
 * `commit` callback. The shared {@link SubConfirmDialog} renders the
 * description; tapping Confirm fires `commit()`.
 *
 * Keeping this tiny + UI-agnostic means the existing board hooks
 * (useBasketballBoardState, NetballBoard's local handlers) stay completely
 * unchanged — we only intercept at the touch layer.
 */
export function useSubConfirm() {
  const [pending, setPending] = useState<{
    payload: SubConfirmPayload;
    commit: () => void;
  } | null>(null);

  const request = useCallback((payload: SubConfirmPayload, commit: () => void) => {
    setPending({ payload, commit });
  }, []);

  const confirm = useCallback(() => {
    if (!pending) return;
    pending.commit();
    setPending(null);
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, request, confirm, cancel };
}
