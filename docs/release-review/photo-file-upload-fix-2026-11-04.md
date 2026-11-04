# Photo and file upload destination repair — 4 November 2026

## Implemented before promotion

Removed the raw-binary redirect to `verify-iap-receipt-icp?job=media-upload` and its unused release flag. After the existing club/team subscription checks and same-device serialized physical-object allowance check, uploads now invoke the original authenticated Supabase Storage SDK callback. The live client resolves its configured environment: DEV stays DEV; PROD builds use PROD. No hard-coded upload destination, new upload service, elevated browser credentials, Storage permission changes or receipt-handler changes were introduced.

All existing callers retain their buckets, paths, file bytes, MIME, cache settings and overwrite behavior: gallery photos, chat photos/files, scheduled-message attachments, chat-to-gallery copies and Vault documents. Supabase Storage remains responsible for authorization. Denials and unknown write outcomes do not trigger another service or a replay. Vault retains its existing server quota reservation/settlement and compensation flow. The combined allowance helper remains an app-side, same-device check, not a new cross-device quota guarantee.

Upload descriptors additionally verify actual Blob size, supported bucket and same-club path before checking allowance. Personal/unassigned uploads retain their existing callback flow. ICP uploads and their encryption/routing were not modified.

## Verification

- Before repair, eight signed-in simulated transport cases failed with `Purchase-receipt upload path invoked`.
- After repair, those same cases use the real Supabase Storage SDK and intercepted requests to each DEV/PROD origin. They verify the exact `/storage/v1/object/<bucket>/<path>` URL, POST, file content and MIME, without contacting either hosted project.
- Tested PNG and PDF objects across photos, chat attachments and competition-vault. Transport success for a bucket is not proof that its hosted policies permit that upload.
- Five focused suites: **58 passed, 13 mode-specific skips**. Coverage includes allowance failures, mismatched file size/club paths, authorization-error propagation, unknown-outcome no replay, Vault upload/compensation and scheduled/gallery callsites.
- Preview compiler reported `build OK` after source changes.
- Read-only DEV policy inspection found ordinary photos/chat INSERT policies, but `competition_vault_writes_service_only` and `competition_vault_updates_service_only` prohibit direct competition-vault writes. These restrictions were preserved. The older release-flag comment claiming installed measured upload machinery is not authoritative: its handler and migrations are absent from this checkout.

## Remaining acceptance, not claimed complete

No hosted object was uploaded, changed or deleted; no PROD deployment occurred. This workspace cannot authenticate against PROD, so real existing-user upload and UI readback remain unverified. A production denial must remain a denial—not a fallback to a receipt service or service-role browser upload.

Competition-vault's separate bucket/access dependencies and service-only write policy still need their own authorized repair/release. This destination fix does not make that blocked feature usable, weaken its permissions or certify the whole frontend for promotion.