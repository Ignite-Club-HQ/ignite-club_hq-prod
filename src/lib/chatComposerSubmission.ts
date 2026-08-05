export type RetryChatSubmission = (imeFlushed: true) => void;

/**
 * Commit any active native IME composition before a chat page reads its draft.
 * Returns true when submission has been deferred to the next task.
 */
export function prepareChatComposerSubmission(
  imeFlushed: boolean,
  retry: RetryChatSubmission,
): boolean {
  if (imeFlushed) return false;

  try {
    window.dispatchEvent(new Event("chat:message-sent"));
  } catch {
    // Diagnostics must never block a send.
  }

  const activeElement = document.activeElement as HTMLElement | null;
  if (
    !activeElement ||
    (activeElement.tagName !== "TEXTAREA" && activeElement.tagName !== "INPUT")
  ) {
    return false;
  }

  activeElement.blur();
  setTimeout(() => {
    retry(true);
    try {
      activeElement.focus({ preventScroll: true });
    } catch {
      // The element may have unmounted while submission completed.
    }
  }, 0);
  return true;
}
