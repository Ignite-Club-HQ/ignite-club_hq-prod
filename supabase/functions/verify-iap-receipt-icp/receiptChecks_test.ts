import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { checkAppleReceipt, DEFAULT_APPLE_BUNDLE_ID as B } from "./receiptChecks.ts";

const now = 1_000;
const ok = (entry: Record<string, string>, bundle = B) => ({
  status: 0,
  receipt: { bundle_id: bundle, in_app: [{ product_id: "pro", transaction_id: "t1", ...entry }] },
});

Deno.test("accepts matching product, app and future expiry", () => {
  assertEquals(checkAppleReceipt(ok({ expires_date_ms: "5000" }), "t1", "pro", B, now), { expiresAtMs: 5000 });
});
Deno.test("rejects a different product", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000" }), "t1", "club_pro", B, now), Error, "different product");
});
Deno.test("rejects a receipt from another app", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000" }, "com.other"), "t1", "pro", B, now), Error, "different app");
});
Deno.test("rejects refunded purchases", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000", cancellation_date_ms: "900" }), "t1", "pro", B, now), Error, "refunded");
});
Deno.test("rejects expired subscriptions", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "500" }), "t1", "pro", B, now), Error, "expired");
});
Deno.test("rejects non-Apple (Android) purchase data", () => {
  assertThrows(() => checkAppleReceipt({ status: 21002 }, "t1", "pro", B, now), Error, "Only App Store");
});
