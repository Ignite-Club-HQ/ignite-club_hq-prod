# Native In-App Purchase (Apple / Google) verification

Native purchases are verified **server side** before any entitlement is granted.
Stripe web checkout and the Stripe webhook are unaffected by anything in this
document.

## Flow

1. `check-iap-authorization` – pre-flight role check before the native sheet opens.
2. Native store purchase (`@capgo/native-purchases`).
3. `verify-iap-receipt`:
   - validates the bearer token (fail closed) and request size (8 KB max);
   - accepts only `platform` (`ios`/`android`), `productId`, `entityId`, `transactionId`, `receipt`;
   - resolves the product in the **server-owned catalogue** (`_shared/iapCatalogue.ts`) –
     entity type, tier, plan, duration and storage allocation are NEVER taken from the client;
   - checks the caller's role for the target club/team;
   - verifies the purchase with Apple/Google (`_shared/iapStoreVerification.ts`);
   - calls `public.apply_verified_iap_purchase(jsonb)` – a `SECURITY DEFINER`
     transactional RPC executable **only by `service_role`** – which records the
     transaction and applies the entitlement atomically.

Replay protection: unique `(platform, transaction_id)` and
`(platform, purchase_token)` in `public.iap_transactions`. A repeat of the same
verified purchase by the same user/entity/product returns `{ idempotent: true }`
and does **not** add storage twice; the same transaction presented for a
different user, club, team or product is rejected (`409`).

Atomicity: the transaction row and the entitlement write happen inside one
function call, so any failure rolls back both. A failed verification writes
nothing at all.

## Required secrets (set via Lovable secrets – never committed)

### Apple (App Store Server API)
| Secret | Where it comes from |
| --- | --- |
| `APPLE_IAP_ISSUER_ID` | App Store Connect → Users and Access → Integrations → In-App Purchase → Issuer ID |
| `APPLE_IAP_KEY_ID` | Key ID of the In-App Purchase key |
| `APPLE_IAP_PRIVATE_KEY` | Contents of the downloaded `.p8` private key (PEM) |
| `APPLE_IAP_BUNDLE_ID` | iOS bundle identifier of the shipped app |
| `APPLE_IAP_ENVIRONMENT` | `production`, `sandbox`, or `auto` (tries production then sandbox) |

### Google (Play Developer API)
| Secret | Where it comes from |
| --- | --- |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Cloud service-account JSON, granted access in Play Console → Users and permissions (View financial data / Manage orders) with the Android Publisher API enabled |
| `GOOGLE_PLAY_PACKAGE_NAME` | Android application id of the shipped app |

Dev and prod each need their own values (dev should use sandbox/test
credentials). **Until these are configured, native purchases fail closed with
HTTP 503 and no entitlement is granted** — this is intentional. Stripe web
upgrades remain fully functional in the meantime.

## Still outstanding (renewals / revocations)

Initial verification and activation are complete and atomic. Lifecycle handling
is **not** complete:

- Apple App Store Server Notifications V2 and Google Play Real-time Developer
  Notifications endpoints are not implemented yet.
- Renewals extend `expires_at` only when the app re-verifies; refunds,
  chargebacks, cancellations and revocations after activation are not yet
  reflected automatically.
- `iap_transactions` now stores everything needed for that reconciliation
  (`platform`, `transaction_id`, `original_transaction_id`, `purchase_token`,
  `environment`, `expires_at`, `store_status`), so a scheduled reconciliation job
  or notification webhook can be added without a data migration.

Do not describe native subscription lifecycle handling as complete until those
endpoints exist.

## Notes

- Store credentials, receipts, purchase tokens and raw store responses are never
  logged or returned; only structured non-sensitive diagnostics are logged.
- Apple's transaction JWS is fetched directly from Apple's authenticated API over
  TLS; the payload is decoded and its structure validated. Full `x5c` certificate
  chain validation is a defence-in-depth improvement, not a substitute for the
  authenticated fetch.
- Request rate limiting is not implemented: the backend has no standard
  rate-limiting primitive. Abuse is bounded instead by authentication, role
  checks, store verification and database uniqueness.
