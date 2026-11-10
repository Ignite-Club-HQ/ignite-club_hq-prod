# Remote media and purchase verification — feasibility assessment

Scope: items 2 and 3 only. Direct branded hosting and optional chat relay are postponed. Research/source inspection only; no application, billing, push, credential, service or production changes.

## 2. Saved GIFs and preview images

### GIPHY: technically possible, not permitted by the standard integration rules

GifGrid searches GIPHY directly and passes the original media URL to the chat picker; it does not upload GIF bytes. The current official API documentation explicitly says:

> Do not cache API responses or media URLs or cache or store copies of GIPHY's media assets.
> Do not proxy requests to GIPHY, either API calls or media URL loads. All requests to GIPHY should be made directly from the client side.

Source checked: https://developers.giphy.com/docs/api/ (Best Practices, retrieved 10 November 2026).

Therefore do not implement a canister-side GIPHY downloader/archive under the current standard integration. Written provider authorization would be required for a different arrangement. This corrects the earlier suggestion that saved GIPHY bytes were an uncomplicated optional move. It does not audit or change existing message URL retention.

Member-owned or appropriately licensed animated files can use ICP upload infrastructure, subject to supported animated MIME handling, scope and file limits. This is a distinct user-upload feature, not permission to mirror GIPHY search results.

### Link-preview images: technically feasible, conditional benefit

LinkPreview currently retrieves metadata from ICP in DEV, but its img src still points to the source website/CDN. Mirroring a small permitted thumbnail could remove that repeat external image load and make it less dependent on the source staying available.

Two approaches:
- Device fetch then existing scoped encrypted upload: reuses current media storage, but browser CORS prevents many arbitrary image downloads; a universally working web import cannot be promised.
- Canister HTTPS fetch plus storage: avoids browser CORS and keeps fetching on ICP, but requires a bounded public-media ingestion path. Existing media uploads encrypt client-side and are member-authorized; a canister fetch must not silently place plaintext into that private ciphertext path or give all club members access to private-chat media.

Any implementation needs HTTPS/public-host and redirect validation, MIME/signature checks, strict byte/decode limits, source/license retention, quota accounting, exact chat audience, deletion/retention and failure-to-original-link behavior. Canister outcalls have a 2,000,000-byte maximum response including headers; increasing the existing preview cap alone cannot accommodate arbitrarily large originals. Replicated bytes may vary across CDN responses. Use small thumbnails, not full-image archives or catalog mirrors.

Trade-off: extra download/write work on first use, ongoing ICP storage/cycles and moderation/removal responsibility. No live costs or timings were measured. Recommendation: keep ordinary preview images external for now unless source-independent thumbnails are an explicit product requirement; prioritize owned/licensed uploads over arbitrary web mirrors.

## 3. App-store verification

### Current source path

- useInAppPurchase, UpgradeProPage, ClubUpgradePage and StoragePurchaseDialog use native store purchase UI and the ICP receipt endpoint.
- verify-iap-receipt-icp verifies Apple legacy receipts externally, then signs principal/product/transaction/expiry/source with a shared HMAC.
- identity_access verifies that attestation, stores entitlements on ICP and prevents an already-redeemed transaction being assigned to another principal.
- The same endpoint source also contains an unrelated legacy push-kick job. Do not remove/redeploy/rewrite it casually as a billing migration; push must remain separate and unchanged.

### Findings requiring separate repair before migration

1. The inspected ICP endpoint contains only Apple legacy receipt verification, despite Android callers also using it. No Google Play purchase verification branch exists in that source. Hosted code may differ; no live Android purchase or hosted function was exercised, so this is a source gap, not a confirmed live failed payment.
2. The verifier looks up transaction_id but does not compare Apple's matched product_id against the requested product_id, validate the receipt app identity/environment policy or bind the receipt's purchaser to the supplied Internet Identity principal. The on-chain HMAC protects the resulting assertion, not the accuracy of the external checks. First-redemption binding is not proof of legitimate receipt ownership.
3. Comments advertise StoreKit 2 JWS and optional Apple Server API credentials, but executable receipt verification only calls legacy verifyReceipt. The installed native plugin supports a signed JWS payload and appAccountToken, which could underpin a new flow; the current purchase options do not supply that account binding.
4. Renewal/refund/revocation handling needs a lifecycle inventory, not just a successful initial receipt check. No claim of complete current lifecycle coverage or working native purchases is made.

### Apple: best candidate for partial on-chain verification

StoreKit 2 supplies Apple-signed JWS transaction data. ICP could verify that locally with public trust anchors instead of sending an Apple shared secret. Required implementation: ES256 and full X.509 chain checks, Apple trust roots, certificate validity/revocation policy, exact app/bundle/product/environment, transaction/original-transaction replay binding, authenticated account UUID mapping (appAccountToken), expiry and purchase/revocation state. Never merely decode the JWS or trust the device's verification flag.

This removes the external verifier for authenticated signed evidence, not Apple billing. Initial signed data is a snapshot, not a guarantee of no subsequent refund. Trusted renewal/refund notifications or authenticated current-state refresh remain necessary; credential-bearing Apple Server API requests should remain external under the existing credential-safety constraint. Apple's maintained server libraries are a reference but cannot simply run inside an ICP Wasm canister without adaptation. Feasible, moderate-to-large security-sensitive work; no ready implementation/benchmark exists here.

Sources:
- https://developer.apple.com/videos/play/wwdc2023/10143/
- https://developer.apple.com/videos/play/wwdc2025/249/
- https://raw.githubusercontent.com/apple/app-store-server-library-node/main/jws_verification.ts
- https://developer.apple.com/documentation/appstoreserverapi/appaccounttoken

### Google: retain a minimal authenticated external verifier

Google recommends secure-server verification using the Play Developer API; subscriptionsv2.get is the current-state authority. A device token or local signature alone cannot establish current expiry/refunds/revocation. Those API requests require authorization, so moving the HTTP caller to a public ICP canister reintroduces credential-in-use exposure rather than solving it with encrypted storage.

Keep the Google-authorized API call and sensitive credentials in an isolated external verifier. ICP can retain account/product/scope binding, accepted verified state, deduplication and entitlement decisions, with minimal authenticated evidence from the verifier. Renewal/refund notification transport can remain external while ICP processes verified events. Neither existing grants nor prices should change as part of this assessment.

Sources:
- https://developer.android.com/google/play/billing/security
- https://developer.android.com/google/play/billing/lifecycle/subscriptions

## Recommended order

1. Do not archive GIPHY content under current rules; leave search/media delivery external.
2. Consider only owned/licensed animated uploads or explicitly permitted small thumbnails if worth the extra cost and permission work.
3. First audit/repair the existing ICP purchase verifier's platform/product/app/account/lifecycle checks in DEV with credential-free fixtures. Keep the unrelated push job and all email-mode purchase behavior untouched.
4. Then prototype Apple signed-transaction validation on ICP, retaining external authenticated lifecycle transport where needed; leave Google's credential-bearing verification external.

This assessment grants no implementation, deployment, credentials or production-data authority. Device/store sandbox purchases, hosted verifier differences and billing configurations remain unverified.