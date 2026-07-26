import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { fallbackExpiry, getIapProduct, IAP_CATALOGUE } from "../_shared/iapCatalogue.ts";
import {
  decodeAppleJws,
  readAppleConfig,
  readGoogleConfig,
  StoreVerificationError,
  verifyApplePurchase,
  verifyGooglePurchase,
  type AppleConfig,
  type GoogleConfig,
} from "../_shared/iapStoreVerification.ts";

// A throwaway P-256 key used only to exercise ES256 token signing in tests.
const TEST_EC_PKCS8 = await (async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
})();

const appleConfig: AppleConfig = {
  issuerId: "issuer-1",
  keyId: "key-1",
  privateKeyPem: TEST_EC_PKCS8,
  bundleId: "app.igniteclubhq",
  environment: "production",
};

const googleConfig: GoogleConfig = {
  clientEmail: "svc@example.iam.gserviceaccount.com",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
  packageName: "app.igniteclubhq",
};

function b64url(s: string) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function appleJws(payload: Record<string, unknown>) {
  const header = b64url(JSON.stringify({ alg: "ES256", x5c: ["cert"] }));
  return `${header}.${b64url(JSON.stringify(payload))}.sig`;
}

function appleTx(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: "2000000111111",
    originalTransactionId: "2000000000000",
    bundleId: "app.igniteclubhq",
    productId: "ignite_pro_starter_monthly",
    purchaseDate: Date.UTC(2026, 0, 1),
    expiresDate: Date.UTC(2030, 0, 1),
    inAppOwnershipType: "PURCHASED",
    environment: "Production",
    ...overrides,
  };
}

function appleFetch(status: number, body: unknown): typeof fetch {
  return ((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
}

function googleFetch(status: number, body: unknown): typeof fetch {
  return ((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
}

function googleSub(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    latestOrderId: "GPA.1234-5678-9012-34567",
    startTime: "2026-01-01T00:00:00Z",
    lineItems: [{ productId: "ignite_team_pro_monthly", expiryTime: "2030-01-01T00:00:00Z" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Server-owned catalogue
// ---------------------------------------------------------------------------

Deno.test("catalogue: unknown product ids are rejected", () => {
  assertEquals(getIapProduct("ignite_free_pro_forever"), null);
  assertEquals(getIapProduct(undefined), null);
  assertEquals(getIapProduct(123 as unknown as string), null);
});

Deno.test("catalogue: entity type, tier, plan and storage are server-owned", () => {
  const club = getIapProduct("ignite_pro_standard_annual")!;
  assertEquals(club.entityType, "club");
  assertEquals(club.tier, "pro");
  assertEquals(club.plan, "standard");
  assertEquals(club.isAnnual, true);
  assertEquals(club.isStorage, false);

  const team = getIapProduct("ignite_team_pf_monthly")!;
  assertEquals(team.entityType, "team");
  assertEquals(team.tier, "pro_football");
  assertEquals(team.plan, undefined);

  const storage = getIapProduct("ignite_storage_50gb_monthly")!;
  assertEquals(storage.isStorage, true);
  assertEquals(storage.storageGb, 50);
  assertEquals(storage.entityType, "club");
});

Deno.test("catalogue: every entry is internally consistent", () => {
  for (const [key, p] of Object.entries(IAP_CATALOGUE)) {
    assertEquals(key, p.productId);
    if (p.isStorage) {
      assertEquals(p.entityType, "club");
      assertEquals(typeof p.storageGb, "number");
    } else {
      assertEquals(p.storageGb, undefined);
    }
  }
});

Deno.test("catalogue: fallback expiry follows the plan duration", () => {
  const from = new Date("2026-01-31T00:00:00Z");
  const monthly = fallbackExpiry(getIapProduct("ignite_pro_starter_monthly")!, from);
  const annual = fallbackExpiry(getIapProduct("ignite_pro_starter_annual")!, from);
  assertEquals(annual.getUTCFullYear(), 2027);
  assertEquals(monthly > from, true);
});

// ---------------------------------------------------------------------------
// Missing credentials must fail closed
// ---------------------------------------------------------------------------

Deno.test("apple config: missing secrets fail closed (no config returned)", () => {
  assertEquals(readAppleConfig(() => undefined), null);
  assertEquals(
    readAppleConfig((k) => (k === "APPLE_IAP_ISSUER_ID" ? "iss" : undefined)),
    null,
  );
});

Deno.test("google config: missing or malformed service account fails closed", () => {
  assertEquals(readGoogleConfig(() => undefined), null);
  assertEquals(
    readGoogleConfig((k) => (k === "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON" ? "{not json" : "pkg")),
    null,
  );
  assertEquals(
    readGoogleConfig((k) => (k === "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON" ? "{}" : "pkg")),
    null,
  );
});

// ---------------------------------------------------------------------------
// Apple verification (network boundary mocked)
// ---------------------------------------------------------------------------

Deno.test("apple: valid club purchase is verified with store-owned facts", async () => {
  const result = await verifyApplePurchase({
    config: appleConfig,
    transactionId: "2000000111111",
    expectedProductId: "ignite_pro_starter_monthly",
    fetchImpl: appleFetch(200, { signedTransactionInfo: appleJws(appleTx()) }),
  });
  assertEquals(result.platform, "ios");
  assertEquals(result.productId, "ignite_pro_starter_monthly");
  assertEquals(result.transactionId, "2000000111111");
  assertEquals(result.appId, "app.igniteclubhq");
  assertEquals(result.purchaseToken, null);
});

Deno.test("apple: valid team purchase is verified", async () => {
  const result = await verifyApplePurchase({
    config: appleConfig,
    transactionId: "3000000222222",
    expectedProductId: "ignite_team_pro_annual",
    fetchImpl: appleFetch(200, {
      signedTransactionInfo: appleJws(appleTx({ transactionId: "3000000222222", productId: "ignite_team_pro_annual" })),
    }),
  });
  assertEquals(result.productId, "ignite_team_pro_annual");
});

Deno.test("apple: valid storage purchase is verified", async () => {
  const result = await verifyApplePurchase({
    config: appleConfig,
    transactionId: "4000000333333",
    expectedProductId: "ignite_storage_10gb_monthly",
    fetchImpl: appleFetch(200, {
      signedTransactionInfo: appleJws(appleTx({ transactionId: "4000000333333", productId: "ignite_storage_10gb_monthly" })),
    }),
  });
  assertEquals(result.productId, "ignite_storage_10gb_monthly");
});

Deno.test("apple: fabricated transaction id is rejected (404 from store)", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "fabricated-999",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(404, {}),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "purchase_not_found");
  assertEquals(err.httpStatus, 400);
});

Deno.test("apple: malformed/unsigned store response is rejected", () => {
  const bad = ["", "a.b", `${b64url(JSON.stringify({ alg: "none" }))}.${b64url("{}")}.x`];
  for (const jws of bad) {
    let threw = false;
    try {
      decodeAppleJws(jws);
    } catch (e) {
      threw = e instanceof StoreVerificationError && e.code === "invalid_store_response";
    }
    assertEquals(threw, true);
  }
});

Deno.test("apple: wrong bundle id is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(200, { signedTransactionInfo: appleJws(appleTx({ bundleId: "com.attacker.app" })) }),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "app_mismatch");
});

Deno.test("apple: product id mismatch is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_unlimited_monthly",
        fetchImpl: appleFetch(200, { signedTransactionInfo: appleJws(appleTx()) }),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "product_mismatch");
});

Deno.test("apple: expired purchase is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(200, {
          signedTransactionInfo: appleJws(appleTx({ expiresDate: Date.UTC(2020, 0, 1) })),
        }),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "purchase_not_active");
});

Deno.test("apple: revoked/refunded purchase is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(200, {
          signedTransactionInfo: appleJws(appleTx({ revocationDate: Date.UTC(2026, 5, 1), revocationReason: 1 })),
        }),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "purchase_not_active");
});

Deno.test("apple: family-shared / non-purchased ownership is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(200, {
          signedTransactionInfo: appleJws(appleTx({ inAppOwnershipType: "FAMILY_SHARED" })),
        }),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "ownership_invalid");
});

Deno.test("apple: transient store failure fails closed as unavailable", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(503, {}),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "store_unavailable");
  assertEquals(err.httpStatus, 503);
});

Deno.test("apple: rejected credentials fail closed as not configured", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(401, {}),
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "store_not_configured");
});

Deno.test("apple: errors never expose store payloads to the client", async () => {
  const err = await assertRejects(
    () =>
      verifyApplePurchase({
        config: appleConfig,
        transactionId: "2000000111111",
        expectedProductId: "ignite_pro_starter_monthly",
        fetchImpl: appleFetch(200, { signedTransactionInfo: appleJws(appleTx({ bundleId: "com.attacker.app" })) }),
      }),
    StoreVerificationError,
  );
  assertEquals(err.clientMessage.includes("attacker"), false);
  assertEquals(err.clientMessage.includes("signedTransactionInfo"), false);
});

// ---------------------------------------------------------------------------
// Google verification (network boundary mocked)
// ---------------------------------------------------------------------------

Deno.test("google: valid team purchase is verified with store-owned facts", async () => {
  const result = await verifyGooglePurchase({
    config: googleConfig,
    purchaseToken: "token-abc",
    expectedProductId: "ignite_team_pro_monthly",
    fetchImpl: googleFetch(200, googleSub()),
    accessToken: "test-access-token",
  });
  assertEquals(result.platform, "android");
  assertEquals(result.purchaseToken, "token-abc");
  assertEquals(result.transactionId, "GPA.1234-5678-9012-34567");
  assertEquals(result.appId, "app.igniteclubhq");
  assertEquals(result.expiresAt, "2030-01-01T00:00:00Z");
});

Deno.test("google: valid club purchase is verified", async () => {
  const result = await verifyGooglePurchase({
    config: googleConfig,
    purchaseToken: "token-club",
    expectedProductId: "ignite_pro_standard_monthly",
    fetchImpl: googleFetch(200, googleSub({ lineItems: [{ productId: "ignite_pro_standard_monthly", expiryTime: "2030-01-01T00:00:00Z" }] })),
    accessToken: "t",
  });
  assertEquals(result.productId, "ignite_pro_standard_monthly");
});

Deno.test("google: fabricated purchase token is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyGooglePurchase({
        config: googleConfig,
        purchaseToken: "made-up",
        expectedProductId: "ignite_team_pro_monthly",
        fetchImpl: googleFetch(404, {}),
        accessToken: "t",
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "purchase_not_found");
});

Deno.test("google: wrong product for the token is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyGooglePurchase({
        config: googleConfig,
        purchaseToken: "token-abc",
        expectedProductId: "ignite_pro_unlimited_monthly",
        fetchImpl: googleFetch(200, googleSub()),
        accessToken: "t",
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "product_mismatch");
});

Deno.test("google: cancelled/expired/on-hold states are rejected", async () => {
  for (const state of [
    "SUBSCRIPTION_STATE_EXPIRED",
    "SUBSCRIPTION_STATE_CANCELED",
    "SUBSCRIPTION_STATE_ON_HOLD",
    "SUBSCRIPTION_STATE_PENDING",
    "SUBSCRIPTION_STATE_PAUSED",
  ]) {
    const err = await assertRejects(
      () =>
        verifyGooglePurchase({
          config: googleConfig,
          purchaseToken: "token-abc",
          expectedProductId: "ignite_team_pro_monthly",
          fetchImpl: googleFetch(200, googleSub({ subscriptionState: state })),
          accessToken: "t",
        }),
      StoreVerificationError,
    );
    assertEquals(err.code, "purchase_not_active");
  }
});

Deno.test("google: expired line item is rejected even when state looks active", async () => {
  const err = await assertRejects(
    () =>
      verifyGooglePurchase({
        config: googleConfig,
        purchaseToken: "token-abc",
        expectedProductId: "ignite_team_pro_monthly",
        fetchImpl: googleFetch(200, googleSub({
          lineItems: [{ productId: "ignite_team_pro_monthly", expiryTime: "2020-01-01T00:00:00Z" }],
        })),
        accessToken: "t",
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "purchase_not_active");
});

Deno.test("google: transient API failure fails closed", async () => {
  const err = await assertRejects(
    () =>
      verifyGooglePurchase({
        config: googleConfig,
        purchaseToken: "token-abc",
        expectedProductId: "ignite_team_pro_monthly",
        fetchImpl: googleFetch(500, {}),
        accessToken: "t",
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "store_unavailable");
});

Deno.test("google: bad credentials fail closed as not configured", async () => {
  const err = await assertRejects(
    () =>
      verifyGooglePurchase({
        config: googleConfig,
        purchaseToken: "token-abc",
        expectedProductId: "ignite_team_pro_monthly",
        fetchImpl: googleFetch(403, {}),
        accessToken: "t",
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "store_not_configured");
});

Deno.test("google: malformed response is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyGooglePurchase({
        config: googleConfig,
        purchaseToken: "token-abc",
        expectedProductId: "ignite_team_pro_monthly",
        fetchImpl: ((_u: string) => Promise.resolve(new Response("not-json", { status: 200 }))) as unknown as typeof fetch,
        accessToken: "t",
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "invalid_store_response");
});

Deno.test("google: missing order id is rejected", async () => {
  const err = await assertRejects(
    () =>
      verifyGooglePurchase({
        config: googleConfig,
        purchaseToken: "token-abc",
        expectedProductId: "ignite_team_pro_monthly",
        fetchImpl: googleFetch(200, googleSub({ latestOrderId: "" })),
        accessToken: "t",
      }),
    StoreVerificationError,
  );
  assertEquals(err.code, "invalid_store_response");
});
