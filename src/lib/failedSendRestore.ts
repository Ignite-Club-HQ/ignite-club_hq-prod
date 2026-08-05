/**
 * Shared failed-send recovery helpers for every chat surface.
 *
 * Chat composers clear immediately on Send (optimistic UX). When the online
 * insert genuinely fails we must:
 *  - remove ONLY that mutation's optimistic row (never a whole-cache snapshot
 *    rollback, which would discard concurrent sends / realtime rows), and
 *  - restore the unsent text / attachment / reply target / pending poll ONLY
 *    when the user has not entered newer content since pressing Send.
 *
 * Offline-queued sends are NOT failures and must never be restored.
 */

export interface FailedSendContext<TReply = unknown> {
  /** Collision-resistant, mutation-specific optimistic row id. */
  tempId: string;
  /** Text exactly as submitted, with any poll markup already stripped. */
  sentText: string;
  sentImageUrl: string | null;
  previousReplyTarget: TReply | null;
  /** Poll attached to the failed send (surfaces that support polls). */
  pendingPollId: string | null;
}

/** Mutation-specific temp id — `Date.now()` alone collides on rapid sends. */
export function createSendTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const POLL_MARKUP_RE = /\s*\[poll:([^\]]+)\]\s*/;

/**
 * Splits `"caption [poll:abc]"` into its composer parts so a failed poll send
 * restores the poll chip instead of leaking `[poll:...]` as ordinary text.
 */
export function splitPollMarkup(text: string): { baseText: string; pollId: string | null } {
  const match = text.match(POLL_MARKUP_RE);
  if (!match) return { baseText: text, pollId: null };
  return {
    baseText: text.replace(POLL_MARKUP_RE, " ").trim(),
    pollId: match[1] || null,
  };
}

export interface RestoreComposerOptions<TReply> {
  context: FailedSendContext<TReply> | undefined | null;
  setText: (updater: (current: string) => string) => void;
  setImage?: (updater: (current: string | null) => string | null) => void;
  setReply?: (updater: (current: TReply | null) => TReply | null) => void;
  setPoll?: (updater: (current: string | null) => string | null) => void;
}

/**
 * Conditionally restores composer state after a failed send. Every field uses
 * a functional setter and only fills a still-empty slot, so newer user input
 * (typed text, a newer attachment/reply/poll selection) is never overwritten.
 */
export function restoreFailedSendComposer<TReply>({
  context,
  setText,
  setImage,
  setReply,
  setPoll,
}: RestoreComposerOptions<TReply>): void {
  if (!context) return;

  if (context.sentText) {
    setText((current) => (current.trim().length === 0 ? context.sentText : current));
  }
  if (context.sentImageUrl && setImage) {
    setImage((current) => current ?? context.sentImageUrl);
  }
  if (context.previousReplyTarget && setReply) {
    setReply((current) => current ?? context.previousReplyTarget);
  }
  if (context.pendingPollId && setPoll) {
    setPoll((current) => current ?? context.pendingPollId);
  }
}

/**
 * True when the authoritative (non-temp) message already exists — i.e. the
 * insert actually succeeded and arrived via Realtime despite the error. In
 * that case we must not show a failure or restore the draft.
 */
export function authoritativeMessageExists(
  messages: Array<{ id: string; author_id?: string | null; text?: string | null }> | null | undefined,
  args: { authorId?: string | null; text: string },
): boolean {
  if (!messages?.length) return false;
  return messages.some(
    (m) =>
      !m.id.startsWith("temp-") &&
      !m.id.startsWith("queued-") &&
      (!args.authorId || m.author_id === args.authorId) &&
      (m.text ?? "") === args.text,
  );
}
