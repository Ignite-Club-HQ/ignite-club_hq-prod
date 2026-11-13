# ICP legal-version contract (DEV and PROD)

The `identity_access.set_terms_acceptance(nat32)` method accepts only a **positive** 32-bit legal document version. Do not submit a Unix-millisecond timestamp or zero.

## Encoding

The existing admin `legal_reacceptance.version` label must be a valid `YYYY-MM-DD` release identifier, e.g. `2026-08-01`, when the ICP reacceptance switch is enabled. The frontend maps it to the integer `20260801`, independent of the switch-activation time `effective_at`. The backend still checks that each account's new accepted version strictly exceeds its previously accepted version. A later legal release must therefore have a later date label. Reusing the same date for a changed document is not supported; publish the next document with a later version or explicitly evolve the contract before enabling a same-day update.

If the config is missing, disabled, malformed or lacks a version, the frontend returns a sentinel `0`, but **never writes it**. When reacceptance is required and the version is invalid, the gate remains closed and throws a clear error; it must not silently mark legal consent.

## Initial signup versus forced reacceptance

The `legal_reacceptance` switch is an **admin-controlled, global forced reacceptance**, not an authoritative statement that a new customer's legal consent has already been recorded, and must not be enabled solely to unblock ChatGPT onboarding.

**Unresolved:** the legal pages at `https://igniteclubhq.com/terms` and `https://igniteclubhq.com/privacy` do not currently expose a separately verified release identifier through the connector. Before calling `set_terms_acceptance` for a new account, publish a real version for the currently displayed documents through an approved configuration path and check the same value from DEV; do not derive it from the date of ChatGPT consent, a synthetic test fixture or a random number. The Terms and Privacy documents must be displayed to the consenting account, and the actor must be that account's authenticated Internet Identity.

The frontend patch corrects the range/encoding bug for already-configured reacceptance. It **does not** itself authorize or perform a Test2 legal acceptance and must not write to PROD.

## First-signup DEV release — reviewed source only

The `legal_reacceptance` flag applies to **forced reacceptance by existing users**. Initial ChatGPT signup uses a distinct, governor/app-admin-published, non-secret `club_domain.app_config` key, `legal_document_release`. It is a **plain** `YYYY-MM-DD` release label for the existing Terms and Privacy documents, not JSON and not the moment of test execution. There is **no default value** and this source change does not publish one.

Before a release administrator sets that key in DEV, the legal document owner must independently review and publish the exact Terms at `https://igniteclubhq.com/terms` and Privacy Policy at `https://igniteclubhq.com/privacy`, and formally approve one shared, monotonic date release identifier for those current texts. Keep the approval/version evidence with the release record. Do not publish a guessed number, choose the date the chat was sent, or enable `legal_reacceptance` as a shortcut. Never change PROD during the DEV rehearsal.

A future approved DEV Group 2 write would use the existing governor/app-admin-gated `set_app_config("legal_document_release", "<approved-YYYY-MM-DD>")` Candid method and must be followed by exact readback. The source patch deliberately performs **no** such write.

### ChatGPT connector-compatible signed read

The DEV Group 2 club-domain OQL interface exposes only the allowlisted `legal_release` entity, with fields `version`, `terms_url`, `privacy_url`. Once the canister source is reviewed, compiled and explicitly upgraded in DEV, a correctly registered caller can read it using the existing **consensus read** `read_account_execute` with:

```json
{"entity":"legal_release","select":["version","terms_url","privacy_url"],"limit":1}
```

It returns **zero rows** if no legal document release has been published. It must never return other `app_config` rows, legal acceptance records, contact information, or a fallback version. The raw query `get_app_config` is not a reliable DFINITY ICP connector read because the connector insists on OQL when this canister publishes OQL; the protected `read_account_execute` update-annotated read is the supported member path. Require the signed account, the correct DEV canister group, a complete declared Candid contract, and caller authorization.

Before any `identity_access.set_terms_acceptance` action, independently verify the release version is a **real calendar date** in strict `YYYY-MM-DD`, convert it to `YYYYMMDD` positive `nat32`, show the actual Terms and Privacy URLs to the caller, obtain their explicit consent to **that** release, verify the selected caller principal, and make exactly one acceptance update. Read back `my_terms_acceptance`. If the row is missing/invalid, differs from the documents, or is not verified against the approved release, **stop**; do not accept zero, version one, the date of testing, or a synthetic test fixture.

When group placement can choose multiple accepting groups, verify the **same approved release** is published and readable in the actually assigned group before declaring ChatGPT onboarding available. A source-only PR or local test does not prove live DEV or PROD correctness.
