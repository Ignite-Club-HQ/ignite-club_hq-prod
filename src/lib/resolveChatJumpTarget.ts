/**
 * Resolve which messageId the chat page should jump to for a push-notification
 * deep link, given the three possible sources of truth:
 *
 *   1. URL `?message=<id>&jump=<nonce>` search params
 *   2. Live `liveJump` event fired by `captureJumpFromNotification`
 *   3. `fallbackJumpId` consumed from sessionStorage at first mount
 *
 * Default priority is URL → live → fallback. EXCEPTION: when both the URL and
 * a live event point at the same chat with DIFFERENT message ids, the source
 * with the newer timestamp wins. This prevents the symptom where tapping a
 * newer push from the same sender opens an older message because the URL
 * search-params update was racing the live event in a single render pass.
 *
 * The returned `nonce` is what the consuming `useEffect` should depend on so
 * a re-tap of the same notification (same messageId, new tap) re-fires the
 * scroll/highlight pass.
 */

export interface ChatJumpResolution {
  messageId: string | null;
  nonce: number | string | undefined;
}

export function resolveChatJumpTarget(args: {
  urlMessageId: string | null;
  urlJumpNonce: string | null;
  liveJumpId: string | null;
  liveJumpTs: number | undefined;
  fallbackJumpId: string | null;
}): ChatJumpResolution {
  const { urlMessageId, urlJumpNonce, liveJumpId, liveJumpTs, fallbackJumpId } = args;

  // Race-aware: when URL and live both have a target but disagree, prefer the
  // newer one by timestamp. urlJumpNonce is set by normalizeNotificationChatUrl
  // as Date.now() at tap time; liveJumpTs is set in the same tap. They should
  // match for a single tap; when they disagree, the newer is the just-tapped
  // notification and the older is a stale URL left over from a prior tap.
  if (urlMessageId && liveJumpId && urlMessageId !== liveJumpId) {
    const urlNonceNum = urlJumpNonce ? Number(urlJumpNonce) : NaN;
    const liveTsNum = typeof liveJumpTs === "number" ? liveJumpTs : NaN;
    if (Number.isFinite(liveTsNum) && (!Number.isFinite(urlNonceNum) || liveTsNum > urlNonceNum)) {
      console.warn("[ChatJump] URL and live-jump disagree; preferring newer live-jump", {
        urlMessageId,
        liveJumpId,
        urlJumpNonce,
        liveJumpTs,
      });
      return { messageId: liveJumpId, nonce: liveTsNum };
    }
  }

  if (urlMessageId) {
    return { messageId: urlMessageId, nonce: urlJumpNonce ?? liveJumpTs };
  }
  if (liveJumpId) {
    return { messageId: liveJumpId, nonce: liveJumpTs };
  }
  return { messageId: fallbackJumpId, nonce: undefined };
}
