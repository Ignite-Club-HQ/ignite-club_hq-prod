/** Plain-English photo action errors; the raw server text is logged, never shown. */
export function mediaActionFailure(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("[media] action refused", message);
  if (/Account admission denied or unavailable/i.test(message)) return "We couldn't confirm your account just now. Please try again in a moment.";
  if (/temporarily locked/i.test(message)) return "This club is being updated. Please try again shortly.";
  if (/forbidden|not authorized|access denied/i.test(message)) return "You don't have access to do that on this photo.";
  return fallback;
}
