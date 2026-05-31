/**
 * Global flag indicating a jump-to-message is currently in flight.
 *
 * When true, all bottom-pinning effects across the chat surface MUST bail
 * out — otherwise the open-pin / stay-pinned compensators race the
 * scrollToIndex("center") and snap the viewport back to the last message,
 * which is exactly the symptom reported when tapping a push notification
 * for a specific message: the user lands on the latest message instead of
 * the targeted one.
 *
 * Set true by `jumpToMessageInVirtualizedChat` on start and reset on end.
 */
let active = false;

export function setChatJumpActive(value: boolean): void {
  active = value;
}

export function isChatJumpActive(): boolean {
  return active;
}
