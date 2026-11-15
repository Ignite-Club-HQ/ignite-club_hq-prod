# DEV-only ChatGPT U10 Parent → encrypted child-name test

**Review state:** proposed code only. This file is NOT authorization to merge, publish the manifest, call child creation or change any live canister. The goal is a single child **Ted**, owned by connected **Test3**, with a name encrypted using the already deployed Group 2 PII authority and a team assignment to U10. No transfer, PROD write, notification or website step.

## Verified preflight targets (reverify just before writes)

- App: `https://ignite-club-launchpad.lovable.app`
- Internet Identity origin: `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app` (obtain through `open_app` again)
- DEV Group 2 club_domain: `yfwyv-nyaaa-aaaal-qxpyq-cai`
- DEV Group 2 pii_access_control: `zt5a6-yiaaa-aaaal-qxp5q-cai`
- Club: `177f8c01-3617-402a-aedd-5c5c17ccfde1`
- Team: `a3e9341e-bc61-4e4d-9ebf-2f2c9f347128` (**ChatGPT Plugin Test U10**)
- Test3 principal (verify again): `mfmwy-tuspw-6ikuj-mfaqb-le2p3-ndi4w-a5caq-cwcit-xhnob-lidne-fae`
- Prior parent invitation accepted; prior Test3 child inventory in G1 and G2 was empty.

## Change boundary and security review

The official ICP connector only accesses canisters advertised by the application's `/.well-known/ic-architecture` manifest. The Group 2 vault has deliberately been omitted. This draft adds an **exact opt-in** for the already pinned DEV Group 2 vault:

```
IGNITE_MCP_DEV_GROUP2_CHILD_PII_DISCOVERY=1
```

The flag is recognized **only** when preparing a manifest for the pinned DEV frontend (`proe7-kqaaa-aaaas-qg6gq-cai`). It is off by default. Publishing this requires a separately approved DEV frontend build/deployment. PROD and other frontends do not inherit it. The validator cross-checks the PII canister against a fixed pin, provision record, independent approved service record, module hash and club_domain subnet approval. Notification queues, timer jobs, workload identities and governors remain excluded.

**Important:** service discovery exposes the **whole PII canister Candid interface** to connector users, not an individual method. It does **not** grant canister-side privileges: `register_pii` requires caller/domain-owner equality; `grant_pii_read` and `grant_pii_read_club` check owner/governor or guardian permissions; encrypted read and vetKey derivation enforce current permission and canister-side revalidation. Nevertheless, the wider connector-reachable interface deserves explicit security review before opt-in deployment. Never publish this PII service to PROD through this flag. **Do not bypass manifest refusal by substituting another app or front-end URL.**

## Local, network-free checks

From the repository root:

```sh
node --test frontend/scripts/iiOriginDist.test.mjs
(cd frontend && node --test scripts/prepare-icp-chatgpt-child-name.test.mjs)
```

The helper depends on the existing frontend `@icp-sdk/core` and `@icp-sdk/vetkeys` packages. The tests generate no child, do not call canisters and use a public fixture key (no passwords, delegations or private material). Source-backed contract review additionally confirms `create_own_child() -> Child`, `set_own_child_team(child_id, team_id, assigned)` and PII `pii_vetkey_verification_key`, `register_pii`, `grant_pii_read`, `grant_pii_read_club`, `get_encrypted_pii_batch`.

## Future ChatGPT connector procedure — **each live write needs its own approval**

1. After a reviewed, separately approved DEV frontend deploy, `open_app` with Test3 and verify the canonical origin. Confirm both `yfwyv...` and `zt5a6...` are declared in its manifest. Fail closed on mismatch.
2. Read Test3 principal and current team `parent` role, U10 active club/team routing, existing Group 1 + Group 2 child inventories, and any potential duplicate. Verify only the intended group canister and only the intended Test3 connection are used.
3. Get the pinned G2 PII canister's **public** `pii_vetkey_verification_key()` through the connector. Validate the source canister and exactly the expected 96-byte public key format. No decrypted keys or wallet material enter ChatGPT.
4. With separate approval, call **one** `create_own_child()` on the **G2 club_domain as Test3**. Record its *returned* child ID. Do not supply a guessed ID or replay an uncertain call. Check the child inventory before any retry.
5. In a trusted local execution context, run `prepareEncryptedChatgptChildName` using **that child ID**, exact U10 club/team, Test3 principal and the public key. Its Candid args use the live application's **IGSK1 + clubchildren:<club> + U+001F shared** format; never write plaintext to club_domain or a generic profile field.
6. After separate approval, send the prepared `registrationArgs` to `zt5a6...` `register_pii` **as Test3**. Match returned `pii_id`, `name`, vetKeys scheme and **entire ciphertext**, or read back via `get_encrypted_pii_batch` with the prepared `readbackArgs` if outcome is uncertain. Do not blindly resubmit an unknown write. Never log plaintext or ciphertext in GitHub.
7. As Test3 and with approval, grant U10 club-scoped read via `grant_pii_read_club` and the parent's own read via `grant_pii_read`. Confirm both succeed (rather than swallowing best-effort failures). Never grant an unrelated club or user.
8. Only when the encrypted name is verified, with approval, set `set_own_child_team(childId, U10_TEAM, true)`. Confirm single child, single U10 team, owner Test3, same G2 authority, no unexpected roles or child records, zero notifications. Name-readback must decrypt exactly `Ted` via the authorized viewer before declaring the *full* test complete.

If the vault cannot be reached, key is not verified, name ciphertext differs, permissions are denied, or a call result is unknown: **stop**, preserve the single child's ID if one exists and report the partial outcome; never manufacture a second child or fall back to Group 1, PROD, another app, or a plaintext field.

## Known limitations

- The helper constructs valid ciphertext and Candid arguments; it does not connect to Internet Identity, sign, submit writes or verify actual deployment. The ICP connector handles authenticated calls.
- Passing local tests does **not** demonstrate a deployed Group 2 PII service publication, secure remote crypto readback, or all on-chain ACL regression tests. Verify separately before treating this as live-ready.
- No UI invite-flow change is bundled: the U10 parent membership was accepted previously through the ChatGPT plugin.
