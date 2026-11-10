import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { checkAppleReceipt, DEFAULT_APPLE_BUNDLE_ID as B, iapAccountToken } from "./receiptChecks.ts";

const now = 1_000;
const T = "11111111-2222-5333-8444-555555555555";
const ok = (entry: Record<string, string>, bundle = B) => ({
  status: 0,
  receipt: { bundle_id: bundle, in_app: [{ product_id: "pro", transaction_id: "t1", app_account_token: T, ...entry }] },
});

Deno.test("accepts matching product, app and future expiry", () => {
  assertEquals(checkAppleReceipt(ok({ expires_date_ms: "5000" }), "t1", "pro", B, now, T), { expiresAtMs: 5000 });
});
Deno.test("rejects a different product", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000" }), "t1", "club_pro", B, now, T), Error, "different product");
});
Deno.test("rejects a receipt from another app", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000" }, "com.other"), "t1", "pro", B, now, T), Error, "different app");
});
Deno.test("rejects refunded purchases", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000", cancellation_date_ms: "900" }), "t1", "pro", B, now, T), Error, "refunded");
});
Deno.test("rejects expired subscriptions", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "500" }), "t1", "pro", B, now, T), Error, "expired");
});
Deno.test("rejects non-Apple (Android) purchase data", () => {
  assertThrows(() => checkAppleReceipt({ status: 21002 }, "t1", "pro", B, now, T), Error, "Only App Store");
});
Deno.test("rejects a purchase linked to another account", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000" }), "t1", "pro", B, now, "99999999-2222-5333-8444-555555555555"), Error, "not linked");
});
Deno.test("rejects a purchase with no account link", () => {
  assertThrows(() => checkAppleReceipt(ok({ expires_date_ms: "5000", app_account_token: "" }), "t1", "pro", B, now), Error, "not linked");
});
Deno.test("account token matches the app's derivation", async () => {
  assertEquals(await iapAccountToken("aaaaa-aa"), "VECTOR");
});
