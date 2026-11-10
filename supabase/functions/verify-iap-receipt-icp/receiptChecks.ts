// Pure checks applied to a verified Apple verifyReceipt response.
// Fail closed: every mismatch throws and no attestation is signed.

export const DEFAULT_APPLE_BUNDLE_ID = "app.lovable.igniteteamhub";

export interface AppleReceiptEntry {
  product_id: string;
  transaction_id: string;
  expires_date_ms?: string;
  purchase_date_ms?: string;
  cancellation_date_ms?: string;
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
