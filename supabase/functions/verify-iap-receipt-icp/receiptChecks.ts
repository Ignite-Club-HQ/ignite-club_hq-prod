// Pure checks applied to a verified Apple verifyReceipt response.
// Fail closed: every mismatch throws and no attestation is signed.

export const DEFAULT_APPLE_BUNDLE_ID = "app.lovable.igniteteamhub";

export interface AppleReceiptEntry {
  product_id: string;
  transaction_id: string;
  expires_date_ms?: string;
  purchase_date_ms?: string;
  cancellation_date_ms?: string;
  app_account_token?: string;
}

export interface AppleReceiptResult {
  status: number;
  receipt?: { bundle_id?: string; in_app?: AppleReceiptEntry[] };
  latest_receipt_info?: AppleReceiptEntry[];
}

// Apple 21002/21003 mean the data is not an App Store receipt (e.g. an
// Android Play token sent to this Apple-only verifier).
const NOT_AN_APPLE_RECEIPT = new Set([21002, 21003]);

export function checkAppleReceipt(
  result: AppleReceiptResult,
  transactionId: string,
  productId: string,
  expectedBundleId: string,
  nowMs: number,
  expectedAccountToken: string,
): { expiresAtMs: number } {
  if (NOT_AN_APPLE_RECEIPT.has(result.status)) {
    throw new Error("Only App Store purchases can be verified in Internet Identity mode.");
  }
  if (result.status !== 0) {
    throw new Error(`Apple receipt verification failed (status ${result.status})`);
  }
  if (result.receipt?.bundle_id !== expectedBundleId) {
    throw new Error("Receipt belongs to a different app.");
  }
  const candidates = [...(result.latest_receipt_info ?? []), ...(result.receipt?.in_app ?? [])];
  const match = candidates.find((e) => e.transaction_id === transactionId);
  if (!match) throw new Error("Transaction id not found in verified Apple receipt.");
  if (match.product_id !== productId) {
    throw new Error("Receipt transaction is for a different product.");
  }
  if ((match.app_account_token ?? "").toLowerCase() !== expectedAccountToken.toLowerCase()) {
    throw new Error("This purchase is not linked to your account.");
  }
  if (match.cancellation_date_ms) throw new Error("This purchase was refunded or cancelled.");
  const expiresAtMs = Number(match.expires_date_ms ?? match.purchase_date_ms ?? NaN);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("Verified Apple receipt did not include an expiry/purchase date.");
  }
  if (match.expires_date_ms && expiresAtMs <= nowMs) {
    throw new Error("This subscription has already expired.");
  }
  return { expiresAtMs };
}

// Deterministic StoreKit 2 appAccountToken for an Internet Identity principal.
// MUST stay byte-identical to frontend/src/live/iapAccountToken.ts.
export async function iapAccountToken(principal: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ignite-iap-account:v1:${principal}`)),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const h = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
