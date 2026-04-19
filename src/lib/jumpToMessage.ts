/**
 * Scroll to a specific message in a chat thread by its DOM id (`message-${id}`).
 * Highlights it briefly via the provided setter to match the existing
 * targetMessageId / search-result UX pattern.
 */
export function jumpToMessageInChat(
  messageId: string,
  setHighlightedMessageId: (id: string | null) => void,
  highlightDurationMs = 2000,
) {
  setHighlightedMessageId(messageId);
  // Defer a frame so any expanded sheet has begun closing
  requestAnimationFrame(() => {
    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
  setTimeout(() => setHighlightedMessageId(null), highlightDurationMs);
}
