# New ICP uploads: forward-only audit

Scope: new uploads in features available with Internet Identity. No historical-file migration, production data reads/writes, storage configuration changes or deployment.

## Existing on-chain paths

- Gallery photos use encrypted blob stores and media metadata, with scope registration and a separately encrypted private Vault copy.
- Vault files use scoped encrypted storage, durable upload intent, and Vault metadata; restricted folders retain their audience encryption.
- Chat photos, device documents and scheduled attachments use ICP upload paths. Chat document tokens are returned only after metadata registration succeeds.
- Profile avatars use encrypted ICP storage and club read grants.
- Club/team/mini-league logos, sponsor logos, rewards/QR/points images and news attachments have ICP branches; their Supabase storage calls belong to email branches.
- Platform advertising uploads in ICP mode are compressed into inline data URLs persisted in insights records, not Supabase storage. They are on-chain, but not encrypted blob-store objects.

## Confirmed defects repaired in DEV

1. The shared upload helper returned null for a missing store or II identity even in ICP mode. Most callers already rejected this, but the shared API still exposed an off-chain fallback signal. It now rejects before reading/encrypting/uploading bytes for ICP or explicit scoped calls. Email fallback remains unchanged.
2. Chat documents registered metadata using their authorized Vault context but did not pass that context to the byte uploader. They now use the same target/identity for both operations, preserving existing encryption and registration order.

Three regression failures were reproduced before repair: two missing-prerequisite fallbacks and missing document upload context.

## Boundaries, not migrations

- CompetitionWelcomeEmailCard explicitly belongs to the email competition settings page; it is excluded, not migrated. Legacy CompetitionMediaPanel storage calls are not proof of an active ICP path.
- Remote GIFs, pasted URLs, external Vault links and built-in bundled images are not new uploaded bytes. Their hosting remains a separate item; this task does not mirror them.
- Club/team creation treats logo upload as a best-effort follow-up and can complete without a logo when storage fails. This remains a user-visible outcome gap, not evidence of an off-chain upload.
- Some legacy logo paths use `club-logos/` rather than `clubs/`; the encryption helper recognizes supported path shapes. This audit does not change existing derivation identities or migrate their files.
- Authenticated upload, metadata readback and decryption on an actual II session/phone are not available in this sandbox. Focused tests prove routing/error contracts, not universal device acceptance.

Next optional external helper to assess: link previews. Source websites remain external even if preview fetching/coordination moves to ICP; assess HTTPS outcall consensus, response size and unsafe URLs before implementation.