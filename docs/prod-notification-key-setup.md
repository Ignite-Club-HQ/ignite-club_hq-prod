# PROD notification key: encrypted browser handover

This prepares an independent ICP notification identity. It does not enable
delivery, change Firebase/Supabase credentials, spend cycles, or call canisters.
The existing Supabase push path and both delivery workflows are unchanged.

## Owner steps

1. Promote the updated tooling: **[REPO] Promote ICP canister code to the live repository**,
   branch **main**, mode **plan**; review differences, then **apply**. Allow differing
   files only after reviewing the listed files. This copies code, not data.
2. In the live repository, save a new dedicated six-word Bitwarden passphrase
   (at least 32 characters) as an Actions **environment secret in environment
   `production`** (Settings → Environments → production → Environment secrets) named
   **PROD_ICP_PUSH_WORKER_PASSPHRASE**. The live repository has only `production` and
   `group-2-admin-controls`; there is no `prod` environment, so a secret saved under a
   `prod` name would never be seen by the run. Keep it in Bitwarden too. Never enter it
   into a workflow input or chat.
3. Run **[PROD] Create notification signing key (delivery off)** on **prod**.
   Open it directly at
   `https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/workflows/prod-create-push-key.yml`
   in a desktop browser — GitHub Mobile has no Run workflow control, and a workflow that
   has never run sits at the bottom of the live repository's long Actions list.
   Confirmation: **CREATE PROD PUSH KEY**.
4. From its Summary, save the encrypted block as GitHub Actions secret
   **PROD_ICP_PUSH_WORKER_SEED_ENC** and the public address as repository variable
   **PROD_ICP_PUSH_WORKER_PRINCIPAL**. Do not decrypt it or set a plaintext seed.
5. Run **[PROD] Create second group (closed)** on **prod**, action **plan**;
   leave hash and confirmation blank. Review the resulting plan before funding
   or creating anything.

## Safeguards and recovery

- Minting runs in the protected production environment, serialized with PROD setup.
- The SDK generates an Ed25519 identity only inside CI. AES-256-GCM with scrypt
  protects the 32-byte seed. Only the ciphertext and public address are persisted.
- A pre-mint intent is acknowledged and read back on `prod-group-setup`, at
  `prod-group-setup/push-key.json`. Existing settings refuse a new key.
- A completed rerun verifies the passphrase and reprints the same encrypted handover;
  it does not mint again. An interrupted pending intent stops for manual review.
  Never delete that intent merely to bypass the safeguard.
- The closed-g2 runner checks the decrypted identity against the recorded public
  address; plaintext never enters logs, files, artifacts or GitHub environment outputs.
- ICP push activation remains a separate, unapproved step. Its existing runner still
  expects the older plaintext-key interface and is deliberately not adapted or enabled
  by this task. Future activation needs encrypted-key integration, queue review and
  phone testing without replacing existing Supabase credentials.

Local tests exercise encryption and interruption handling with deterministic,
non-live identity fixtures. Real key minting and handover require the owner's GitHub run.