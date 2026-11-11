/** Plain-English text for Push Analytics read failures; raw text goes to the console only. */
export function pushAdminErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw) console.warn("Push Analytics read failed:", raw);
  if (/App admin verification unavailable/i.test(raw)) {
    return "Your administrator access couldn't be checked, so statistics aren't available. Test alerts still work. Try refreshing shortly.";
  }
  if (/App admin required/i.test(raw)) {
    return "This alert service hasn't confirmed administrator access for this account, so statistics aren't available. Test alerts aren't affected.";
  }
  if (/admission denied|unavailable|fenced/i.test(raw)) {
    return "One alert service didn't let this account in, so its stats aren't shown. Sending test alerts isn't affected.";
  }
  if (/not configured/i.test(raw)) return "This alert service isn't fully set up yet, so its stats aren't shown.";
  return "Couldn't load alert stats right now. Tap refresh to try again.";
}
