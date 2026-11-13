# ICP legal-version contract (DEV and PROD)

The `identity_access.set_terms_acceptance(nat32)` method accepts only a **positive** 32-bit legal document version. Do not submit a Unix-millisecond timestamp or zero.

## Encoding

The existing admin `legal_reacceptance.version` label must be a valid `YYYY-MM-DD` release identifier, e.g. `2026-08-01`, when the ICP reacceptance switch is enabled. The frontend maps it to the integer `20260801`, independent of the switch-activation time `effective_at`. The backend still checks that each account's new accepted version strictly exceeds its previously accepted version. A later legal release must therefore have a later date label. Reusing the same date for a changed document is not supported; publish the next document with a later version or explicitly evolve the contract before enabling a same-day update.

If the config is missing, disabled, malformed or lacks a version, the frontend returns a sentinel `0`, but **never writes it**. When reacceptance is required and the version is invalid, the gate remains closed and throws a clear error; it must not silently mark legal consent.

## Initial signup versus forced reacceptance

The `legal_reacceptance` switch is an **admin-controlled, global forced reacceptance**, not an authoritative statement that a new customer's legal consent has already been recorded, and must not be enabled solely to unblock ChatGPT onboarding.

**Unresolved:** the legal pages at `https://igniteclubhq.com/terms` and `https://igniteclubhq.com/privacy` do not currently expose a separately verified release identifier through the connector. Before calling `set_terms_acceptance` for a new account, publish a real version for the currently displayed documents through an approved configuration path and check the same value from DEV; do not derive it from the date of ChatGPT consent, a synthetic test fixture or a random number. The Terms and Privacy documents must be displayed to the consenting account, and the actor must be that account's authenticated Internet Identity.

The frontend patch corrects the range/encoding bug for already-configured reacceptance. It **does not** itself authorize or perform a Test2 legal acceptance and must not write to PROD.
