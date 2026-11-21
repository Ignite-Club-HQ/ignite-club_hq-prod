# DEV engine setup and encryption readback

Observed 2026-11-17 at approximately 05:18 UTC, using anonymous ICP SDK calls to `https://icp-api.io` and the eighteen IDs in `singleAppV2Readback` of `dev-engine-installation-observation.json`.

## Verified live

- All eighteen installed module hashes remain identical to the previous verified v2 upload readback.
- All eighteen remain on the expected DEV engine subnet with the sole expected owner controller.
- `pii_access_control.pii_vetkey_verification_key` successfully returns a 96-byte public verification key from the installed engine encryption path. No private keys requested or returned.
- `pii_access_control.club_media_lock_version` returns `1`.

The matching candidate uses the configured proxy `ynolw-eyaaa-aaaaj-qspkq-cai` and `key_1`. Successful public-key retrieval demonstrates that this installed encryption-key path responds; it does not prove paid private-key derivation, membership authorization, or file/photo decryption.

## Blocked verification

All twelve bounded `read_group_opening_configuration` calls reject anonymous access: eleven require the governor; `notification_queue` reports forbidden. These are authorization denials, not proof of missing settings. No settings were changed or access bypassed.

The other six services do not expose the common opening reader: `identity_access`, `migration_coordinator`, `placement_registry`, `secret_workload_identity`, `shard_router`, and `timer_jobs`. Their protected/operator setup is not verified by module presence.

Available workspace connections contain no OpenCloud owner transport. Internet Identity's CLI linking requires the browser and CLI on the same machine and is unsupported in this remote/headless session. No session exports, private keys, or passkeys were requested.

## Remaining acceptance

- Owner-authorized complete service configuration readback, including links omitted by the common opening readers, and the final setup log.
- Signed-in DEV test club, photo and document encryption/decryption roundtrips, including denied outsider/revoked access.

Overall setup and end-to-end encryption remain **unverified**. The public encryption-key service is **verified responding**. No routing, hosting, engine settings, user data, or PROD changes were made.