// Deterministic StoreKit 2 appAccountToken for an Internet Identity principal.
// MUST stay byte-identical to supabase/functions/verify-iap-receipt-icp/receiptChecks.ts,
// which rejects Apple purchases whose token doesn't match the redeeming account.
export async function iapAccountToken(principal: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ignite-iap-account:v1:${principal}`)),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const h = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
