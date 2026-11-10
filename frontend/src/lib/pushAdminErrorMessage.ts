/** Plain-English text for Push Analytics read failures; raw text goes to the console only. */
export function pushAdminErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw) console.warn("Push Analytics read failed:", raw);
  if (/App admin required/i.test(raw)) {
    return "Stats need app admin access on this service. If you are an app admin, the check may not have answered in time. Tap refresh to try again.";
  }
  if (/admission denied|unavailable|fenced/i.test(raw)) {
    return "One alert service didn't let this account in, so its stats aren't shown. Sending test alerts isn't affected.";
  }
  if (/not configured/i.test(raw)) return "This alert service isn't fully set up yet, so its stats aren't shown.";
  return "Couldn't load alert stats right now. Tap refresh to try again.";
}
