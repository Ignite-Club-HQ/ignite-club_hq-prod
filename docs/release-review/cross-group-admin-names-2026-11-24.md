# Cross-group app-admin names — DEV implementation

Paul approved app admins reading member names across every club and canister group on 24 November 2026. This change grants names only, not emails, files, other private fields or management rights.

## Implemented
- Admin-name hydration resolves original PII stores rather than ignoring records outside the current target. The shared DEV admin target explicitly uses the existing independently pinned G1/G2 read resolver; no record, encryption subject or key is moved.
- Modern stores are selected from a complete consensus registry whose configuration matches the governor approval. Opening checks bind the deployment, host, domains and subnets; fresh closing checks reject changed registries or sessions. Browser references do not authorize endpoints.
- Shared identity authorization admits registered PII callers for the exact `app_admin` / `all` audience after verifying the viewer's current global role. The existing final synchronous role/account/profile checks and PII ciphertext/key fences remain intact.
- Original DEV G1 names retain their existing release switch, exact identity/source/key and directory inventory checks. App-admin scope no longer fails the team/club-only origin selector.
- Admin-directory aliases select the original saved name subject, not an arbitrary first login alias. Foreign subject references are excluded. Cross-group admin reads use the existing bounded longer name-read deadline rather than a six-second empty-result timeout.

## Verified locally
- Identity service: **254 passed**, no failures or skips.
- Frontend: **127 passed per sign-in mode** (254 combined), no failures or skips, six focused files.
- Tests cover all registered stores in a three-group registry, both existing DEV sources starting from shared G1, unchanged original authority, unknown stores, incomplete approval, changed registry/configuration, session replacement, original account aliases and foreign-subject refusal.
- Edited-file lint and whitespace checks pass; preview reports build OK.
- No Candid endpoint changes, stable-state migrations, deployments, permissions/configuration writes or production operations.

## Acceptance still required
The sandbox's sign-in status is `external_unmanaged`; there is no delegated Internet Identity administrator session. Real ciphertext/key derivation and decrypted names on the signed-in admin screen, installed-phone behavior and deployed service parity remain unverified. Local tests are not live acceptance or production release approval.

Deployment requires the usual reviewed website and identity-service upgrades, plus the PII-service names-only admin release from the preceding change. This request did not deploy either environment. Existing release, current account denial, source inventory and key-continuity failures remain closed, not bypassed.