/**
 * Store-side verification for native in-app purchases.
 *
 * Nothing in this module trusts the client. A purchase is only considered real
 * when Apple's App Store Server API or Google's Play Developer API confirms it,
 * for OUR bundle/package, for the product the client claimed, in an
 * active/non-revoked state.
 *
 * Fails CLOSED: if store credentials are absent or the store call cannot be
 * completed, we raise `store_not_configured` / `store_unavailable` and grant
 * nothing.
 */

export type IapPlatform = "ios" | "android";

export interface VerifiedPurchase {
  platform: IapPlatform;
  /** Store transaction identifier (Apple transactionId / Google latestOrderId). */
  transactionId: string;
  originalTransactionId: string | null;
  /** Google purchase token; null on iOS. */
  purchaseToken: string | null;
  /** Product id as reported BY THE STORE (never the client). */
  productId: string;
  /** Bundle/package id as reported by the store. */
  appId: string;
  environment: string;
  purchasedAt: string | null;
  expiresAt: string | null;
  storeStatus: string;
}

export type StoreErrorCode =
  | "store_not_configured"
  | "store_unavailable"
  | "invalid_store_response"
  | "purchase_not_found"
  | "purchase_not_active"
  | "app_mismatch"
  | "product_mismatch"
  | "ownership_invalid";

/** HTTP status returned to the client for each failure class. */
const STATUS_BY_CODE: Record<StoreErrorCode, number> = {
  store_not_configured: 503,
  store_unavailable: 503,
  invalid_store_response: 502,
  purchase_not_found: 400,
  purchase_not_active: 400,
  app_mismatch: 400,
  product_mismatch: 400,
  ownership_invalid: 400,
};

/** Client-safe generic messages — never leak store payloads. */
const CLIENT_MESSAGE_BY_CODE: Record<StoreErrorCode, string> = {
  store_not_configured: "In-app purchases are temporarily unavailable. Please try again later.",
  store_unavailable: "We couldn't reach the app store to confirm your purchase. Please try again shortly.",
  invalid_store_response: "We couldn't confirm your purchase with the app store. Please try again shortly.",
  purchase_not_found: "We couldn't find this purchase with the app store.",
  purchase_not_active: "This purchase is not active.",
  app_mismatch: "This purchase doesn't belong to this app.",
  product_mismatch: "This purchase doesn't match the selected plan.",
  ownership_invalid: "This purchase can't be applied to your account.",
};

export class StoreVerificationError extends Error {
  code: StoreErrorCode;
  httpStatus: number;
  clientMessage: string;
  /** Structured server-side diagnostic — safe to log, never returned. */
  diagnostic: Record<string, unknown>;

  constructor(code: StoreErrorCode, diagnostic: Record<string, unknown> = {}) {
    super(code);
    this.name = "StoreVerificationError";
    this.code = code;
    this.httpStatus = STATUS_BY_CODE[code];
    this.clientMessage = CLIENT_MESSAGE_BY_CODE[code];
    this.diagnostic = diagnostic;
  }
}

type FetchImpl = typeof fetch;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodeB64UrlToString(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/[\r\n\s]/g, "");
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Apple — App Store Server API
// ---------------------------------------------------------------------------

export interface AppleConfig {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
  bundleId: string;
  /** "production" | "sandbox" | "auto" */
  environment: string;
}

export function readAppleConfig(env: (k: string) => string | undefined): AppleConfig | null {
  const issuerId = env("APPLE_IAP_ISSUER_ID");
  const keyId = env("APPLE_IAP_KEY_ID");
  const privateKeyPem = env("APPLE_IAP_PRIVATE_KEY");
  const bundleId = env("APPLE_IAP_BUNDLE_ID");
  if (!issuerId || !keyId || !privateKeyPem || !bundleId) return null;
  return {
    issuerId,
    keyId,
    privateKeyPem,
    bundleId,
    environment: (env("APPLE_IAP_ENVIRONMENT") || "production").toLowerCase(),
  };
}

const APPLE_HOSTS = {
  production: "https://api.storekit.itunes.apple.com",
  sandbox: "https://api.storekit-sandbox.itunes.apple.com",
};

export async function createAppleApiToken(config: AppleConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = {
    iss: config.issuerId,
    iat: nowSeconds,
    exp: nowSeconds + 600,
    aud: "appstoreconnect-v1",
    bid: config.bundleId,
  };
  const unsigned = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(config.privateKeyPem),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch (_e) {
    throw new StoreVerificationError("store_not_configured", { reason: "apple_private_key_unusable" });
  }
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

/** Decodes (does not cryptographically re-verify) a JWS fetched over TLS from Apple's authenticated API. */
export function decodeAppleJws(jws: unknown): Record<string, unknown> {
  if (typeof jws !== "string") throw new StoreVerificationError("invalid_store_response", { reason: "jws_missing" });
  const parts = jws.split(".");
  if (parts.length !== 3) throw new StoreVerificationError("invalid_store_response", { reason: "jws_segments" });
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(decodeB64UrlToString(parts[0]));
    payload = JSON.parse(decodeB64UrlToString(parts[1]));
  } catch (_e) {
    throw new StoreVerificationError("invalid_store_response", { reason: "jws_decode" });
  }
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length === 0) {
    throw new StoreVerificationError("invalid_store_response", { reason: "jws_header" });
  }
  if (!parts[2]) throw new StoreVerificationError("invalid_store_response", { reason: "jws_signature_missing" });
  return payload;
}

export async function verifyApplePurchase(opts: {
  config: AppleConfig;
  transactionId: string;
  expectedProductId: string;
  fetchImpl?: FetchImpl;
  now?: number;
}): Promise<VerifiedPurchase> {
  const { config, transactionId, expectedProductId } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  const token = await createAppleApiToken(config);

  const hosts = config.environment === "sandbox"
    ? [APPLE_HOSTS.sandbox]
    : config.environment === "auto"
      ? [APPLE_HOSTS.production, APPLE_HOSTS.sandbox]
      : [APPLE_HOSTS.production];

  let lastStatus = 0;
  let body: Record<string, unknown> | null = null;
  for (const host of hosts) {
    let res: Response;
    try {
      res = await fetchImpl(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch (_e) {
      throw new StoreVerificationError("store_unavailable", { store: "apple", reason: "network" });
    }
    lastStatus = res.status;
    if (res.status === 404) continue;
    if (res.status === 401 || res.status === 403) {
      throw new StoreVerificationError("store_not_configured", { store: "apple", status: res.status });
    }
    if (res.status >= 500) {
      throw new StoreVerificationError("store_unavailable", { store: "apple", status: res.status });
    }
    if (!res.ok) {
      throw new StoreVerificationError("purchase_not_found", { store: "apple", status: res.status });
    }
    try {
      body = await res.json();
    } catch (_e) {
      throw new StoreVerificationError("invalid_store_response", { store: "apple", reason: "json" });
    }
    break;
  }

  if (!body) {
    throw new StoreVerificationError("purchase_not_found", { store: "apple", status: lastStatus });
  }

  const tx = decodeAppleJws((body as Record<string, unknown>).signedTransactionInfo);

  const bundleId = typeof tx.bundleId === "string" ? tx.bundleId : "";
  if (bundleId !== config.bundleId) {
    throw new StoreVerificationError("app_mismatch", { store: "apple" });
  }
  const storeProductId = typeof tx.productId === "string" ? tx.productId : "";
  if (!storeProductId || storeProductId !== expectedProductId) {
    throw new StoreVerificationError("product_mismatch", { store: "apple" });
  }
  const storeTransactionId = typeof tx.transactionId === "string" ? tx.transactionId : "";
  if (!storeTransactionId) {
    throw new StoreVerificationError("invalid_store_response", { store: "apple", reason: "transaction_id" });
  }
  if (tx.revocationDate || tx.revocationReason !== undefined) {
    throw new StoreVerificationError("purchase_not_active", { store: "apple", reason: "revoked" });
  }
  const ownership = typeof tx.inAppOwnershipType === "string" ? tx.inAppOwnershipType : "PURCHASED";
  if (ownership !== "PURCHASED") {
    throw new StoreVerificationError("ownership_invalid", { store: "apple", ownership });
  }
  const expiresMs = typeof tx.expiresDate === "number" ? tx.expiresDate : null;
  if (expiresMs !== null && expiresMs <= now) {
    throw new StoreVerificationError("purchase_not_active", { store: "apple", reason: "expired" });
  }

  return {
    platform: "ios",
    transactionId: storeTransactionId,
    originalTransactionId: typeof tx.originalTransactionId === "string" ? tx.originalTransactionId : null,
    purchaseToken: null,
    productId: storeProductId,
    appId: bundleId,
    environment: typeof tx.environment === "string" ? tx.environment : (config.environment === "sandbox" ? "Sandbox" : "Production"),
    purchasedAt: typeof tx.purchaseDate === "number" ? new Date(tx.purchaseDate).toISOString() : null,
    expiresAt: expiresMs !== null ? new Date(expiresMs).toISOString() : null,
    storeStatus: "active",
  };
}

// ---------------------------------------------------------------------------
// Google — Play Developer API
// ---------------------------------------------------------------------------

export interface GoogleConfig {
  clientEmail: string;
  privateKeyPem: string;
  packageName: string;
}

export function readGoogleConfig(env: (k: string) => string | undefined): GoogleConfig | null {
  const raw = env("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  const packageName = env("GOOGLE_PLAY_PACKAGE_NAME");
  if (!raw || !packageName) return null;
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) return null;
  return { clientEmail: parsed.client_email, privateKeyPem: parsed.private_key, packageName };
}

export async function getGoogleAccessToken(
  config: GoogleConfig,
  fetchImpl: FetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(config.privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (_e) {
    throw new StoreVerificationError("store_not_configured", { reason: "google_private_key_unusable" });
  }
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  let res: Response;
  try {
    res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
  } catch (_e) {
    throw new StoreVerificationError("store_unavailable", { store: "google", reason: "token_network" });
  }
  if (!res.ok) {
    throw new StoreVerificationError("store_not_configured", { store: "google", reason: "token_rejected", status: res.status });
  }
  const body = await res.json().catch(() => null);
  const accessToken = body && typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) {
    throw new StoreVerificationError("store_not_configured", { store: "google", reason: "token_missing" });
  }
  return accessToken;
}

const GOOGLE_ACTIVE_STATES = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"]);

export async function verifyGooglePurchase(opts: {
  config: GoogleConfig;
  purchaseToken: string;
  expectedProductId: string;
  fetchImpl?: FetchImpl;
  now?: number;
  accessToken?: string;
}): Promise<VerifiedPurchase> {
  const { config, purchaseToken, expectedProductId } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  const accessToken = opts.accessToken ?? await getGoogleAccessToken(config, fetchImpl);

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch (_e) {
    throw new StoreVerificationError("store_unavailable", { store: "google", reason: "network" });
  }
  if (res.status === 401 || res.status === 403) {
    throw new StoreVerificationError("store_not_configured", { store: "google", status: res.status });
  }
  if (res.status === 404) {
    throw new StoreVerificationError("purchase_not_found", { store: "google", status: 404 });
  }
  if (res.status >= 500) {
    throw new StoreVerificationError("store_unavailable", { store: "google", status: res.status });
  }
  if (!res.ok) {
    throw new StoreVerificationError("purchase_not_found", { store: "google", status: res.status });
  }

  const body = await res.json().catch(() => null) as Record<string, any> | null;
  if (!body || typeof body !== "object") {
    throw new StoreVerificationError("invalid_store_response", { store: "google", reason: "json" });
  }

  const state = typeof body.subscriptionState === "string" ? body.subscriptionState : "";
  if (!GOOGLE_ACTIVE_STATES.has(state)) {
    throw new StoreVerificationError("purchase_not_active", { store: "google", state });
  }

  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  const matched = lineItems.find((li: any) => li && li.productId === expectedProductId);
  if (!matched) {
    throw new StoreVerificationError("product_mismatch", { store: "google" });
  }

  const expiryTime = typeof matched.expiryTime === "string" ? matched.expiryTime : null;
  if (expiryTime) {
    const expiryMs = Date.parse(expiryTime);
    if (Number.isFinite(expiryMs) && expiryMs <= now) {
      throw new StoreVerificationError("purchase_not_active", { store: "google", reason: "expired" });
    }
  }

  const orderId = typeof body.latestOrderId === "string" && body.latestOrderId ? body.latestOrderId : null;
  if (!orderId) {
    throw new StoreVerificationError("invalid_store_response", { store: "google", reason: "order_id" });
  }

  return {
    platform: "android",
    transactionId: orderId,
    originalTransactionId: orderId.includes("..") ? orderId.split("..")[0] : orderId,
    purchaseToken,
    productId: expectedProductId,
    appId: config.packageName,
    environment: body.testPurchase ? "test" : "production",
    purchasedAt: typeof body.startTime === "string" ? body.startTime : null,
    expiresAt: expiryTime,
    storeStatus: state,
  };
}
