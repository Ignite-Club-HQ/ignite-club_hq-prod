# OpenCloud PROD admission-only commissioning

Status: implemented and validated offline. No live PROD mutation has been run as part of this preparation.

## Scope and invariants

- Target only `ignite_prod_v2` / `opencloud-prod`, API host `https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net`.
- Identity: `fyeax-jqaaa-aaac5-aaeaq-cai`; router: `fwgn7-saaaa-aaac5-aaebq-cai`.
- Registry revision must remain exactly 4, with `base` and `g2` registered and closed.
- The admission build carries immutable pins for the existing 31 backends. The commissioning runner authenticates every live uncompressed module SHA-256 and every controller list against the reviewed artifact before any write.
- Exactly 24 member readers are configured: twelve in each group, including both PII services and both photo stores. The other four protection receivers are checked separately for a total of 28 authenticated receiver readbacks.
- Only `IGNITE_ACCOUNT_SERVICE_IDENTITY` and `IGNITE_ACCOUNT_ADMISSION_RELEASE=1` are merged onto reader environments. Existing settings and controllers are preserved. Removal and rehearsal must remain off.
- Global signed readers, removal, erasure and recovery stay disabled. No group is opened, no routing is approved, and no account, profile, role, alias or PII record is written.
- The additive identity stable-memory cell 40 stores the OpenCloud PROD admission receipt. Its first upgrade initializes only that empty cell; all existing state remains intact. Mainnet signed/witnessed commissioning is unchanged.

## Account and encrypted-name diagnostics

The check reads the bounded existing admin directory, discards plaintext profile DTOs immediately, and calls the governor-only identity diagnostic. That diagnostic checks both PII stores with the existing `verify_secure_profile_name` method and returns only:

- account ID;
- whether a profile exists;
- whether the profile contains an opaque encrypted-name reference;
- per subject/PII authority, whether a valid owned ciphertext record exists.

It never returns plaintext, ciphertext, avatars or vetKeys. A missing profile with no valid owned record means the owner must complete the normal name step. A missing profile with a valid record is evidence for a separate reviewed reconciliation, not permission to synthesize or overwrite a profile. Commissioning does not repair, create, import, rename or delete either kind of account.

## Offline validation completed

- `cargo test -p identity_access`: 265 passed.
- `node --test scripts/opencloud/*.test.mjs`: 46 passed.
- `node --test scripts/workflow-env-names.test.mjs scripts/opencloud/prod-commission.test.mjs scripts/opencloud/deployment.test.mjs`: passed.
- `node frontend/scripts/check-candid-drift.mjs`: 17 active contracts passed.
- Preview build: OK.
- Offline `icp build` with the manifest's `IGNITE_OPENCLOUD_PROD_ADMISSION` pin: all 31 backends built successfully.
- Artifact verification: 31 targets / 18 implementations; compressed WASM, uncompressed module and Candid SHA-256 values all matched the manifest.

Local validation artifact values (the GitHub source run is authoritative for deployment):

- Manifest SHA-256: `b0ba881ad952e047ba9d9435f07399b33699d1b0055d223280c653191105c65c` (superseded if the documentation or final patch changes the manifest).
- Identity module SHA-256: `b4de60cb462364592f93f2c0b8c520be8332e4d823d46872a4c2147b32db953f`.
- Club module SHA-256: `e55b66bf5d52dfd1fe3ab3dd3dfd883e8467cf3309a637116b38d9bdb51de198`.
- PII module SHA-256: `3742ea1edc52245445b945d58a63b612182aa9b6954df1f7bbe41da0d6745587`.

## Exact deployment procedure (PROD only)

1. **Review and merge only the PR targeting `prod`.** Do not merge this change through `main`; that avoids the DEV auto-deployment path. Confirm the repository's existing `OPENCLOUD_PROD_AUTO_DEPLOY=true` setting before merging. If it is not true, stop rather than using any first-install or reinstall workflow.

2. **Let the existing `[PROD] OpenCloud automatic deployment` finish.** It builds the reviewed source and performs data-preserving upgrades only for changed modules. Require a green run for the exact PROD merge commit and inspect its per-canister results. Any `install`, `reinstall`, controller change, unexpected target or hash mismatch is a stop condition.

3. **Run `[PROD] OpenCloud offline source artifacts` manually on `prod`.** Use the exact merge commit. Require a green run and record its numeric run ID. This standalone run supplies the `opencloud-prod-backend-source-build` artifact used by commissioning; an artifact from another commit is rejected.

4. **Run `[PROD] OpenCloud PROD backend commissioning` in `check` mode.** Enter the source run ID from step 3; leave confirmation blank. This performs no setting, authority, account or commissioning writes. Review the sanitized `opencloud-prod-admission-report.json`, its reviewed-plan hash, all 31 module/controller checks, the closed registry, and the account/ciphertext-presence findings.

5. **Review the two missing-profile findings before releasing access.** Do not fabricate names. If either account has valid owned ciphertext despite no profile, hold commissioning for a separate reviewed reconciliation. Otherwise the normal member name-completion flow remains the only repair path.

6. **Run the same workflow in `commission` mode.** Use the identical source run ID and type exactly `COMMISSION OPENCLOUD PROD ADMISSION`. The protected `production` environment supplies the existing PROD governor approval. The runner revalidates the source run and live state, then:
   - merges and reads back the two admission settings on all 24 readers;
   - binds the existing router/timer/workload authorities without releasing removal;
   - performs the read-only inventory review and stores the additive admission receipt;
   - commissions the exact 24 ordinary member readers;
   - configures membership discovery for the `base` and `g2` club sources at generation 1;
   - reads back all 28 receiver modes, both closed groups, both directory sources and the unchanged account/PII diagnostics.

7. **Run `check` once more with the same source run ID.** Require `status=commissioned`, `commissionedReaders=24`, all receiver/directory checks green, and no account diagnostic changes. Then test the existing admin name read with the ordinary PROD admin identity. Saved encrypted names should resolve; accounts without profiles still require their owners to complete the name step.

## Stop conditions

Stop without retrying blindly if the registry is not revision 4, either group is open, any live module/controller differs, any removal/rehearsal/foreign-authority setting is present, any receiver refuses, any account diagnostic changes, the source run does not match the checked-out PROD commit, or a write result is uncertain. Do not recreate, reinstall or delete a canister; do not touch DEV, mainnet, Supabase, Netlify, routing or group opening.
