# DEV-only ChatGPT U10 Parent → encrypted child-name test

**Review state:** proposed code only. This file is NOT authorization to merge, publish the manifest, call child creation or change any live canister. The goal is a single child **Ted**, owned by connected **Test3**, with a name encrypted using the already deployed Group 2 PII authority and a team assignment to U10. No transfer, PROD write, notification or website step.

## Verified preflight targets (reverify just before writes)

- App (canonical ICP frontend): `https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io`
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


## November 15: canonical ICP frontend + executable connector bridge

The DEV frontend now advertises Group 2's PII canister on the **canonical ICP host**, not necessarily on the older Lovable preview origin. The correct app argument for the existing DFINITY connector is:

- app_url: https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io
- derivation_origin: https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app

The SDK helper above is now wrapped by:

- frontend/scripts/prepare-icp-chatgpt-child-name-connector.mjs
- frontend/scripts/prepare-icp-chatgpt-child-name-cli.mjs

The bridge expects the unmodified, exact response objects returned by the existing DFINITY plugin:

1. open_app(app=canonical ICP URL) with Test3: declared Group 2 club_domain and pii_access_control; origin matches.
2. get_app_principal Test3 for that derivation origin; Test3 principal, writable session.
3. read_account_my_role_grants() on the pinned G2 club_domain: single U10 Parent grant in the complete record; an unrelated club_admin role does not qualify.
4. pii_vetkey_verification_key() on the pinned G2 pii_access_control as Test3: exact 96-byte escaped Candid blob.
5. **Only after separately approved creation:** one successful create_own_child() result from pinned G2 club_domain with exact Test3 parent, unassigned child ID and no inherited team.

All response provenance fields (method, canister ID, manifest origin, derivation origin, anonymous flag) must match; altered or incomplete evidence refuses encryption. The bridge is OFFLINE and makes zero canister calls. It uses the same vetted ICP SDK and the same clubchildren IBE identity, random seed and IGSK1 header as the live app.

In a trusted **local** checkout with frontend dependencies already installed, supply ONE complete JSON input object over stdin containing app, identity, roleReceipt, childReceipt, publicKeyReceipt and childName. **Use only synthetic test names in CI.** For actual child data keep the JSON outside the Git repository and GitHub Actions logs. Never pass a child's name as command-line arguments, CI variables, a URL or a public file.

Run from the frontend directory:

    node scripts/prepare-icp-chatgpt-child-name-cli.mjs < /secure/local/child-input.json > /secure/local/encrypted-candid.json

The resulting JSON contains ONLY ciphertext-bearing Candid arguments and scoped routing metadata for separate, individually approved connector calls:
register_pii, get_encrypted_pii_batch, grant_pii_read_club, grant_pii_read and set_own_child_team.
**Do not automatically execute the returned calls.** Check the registration receipt or authorised ciphertext readback before granting/assigning, never retry uncertain writes blindly. Never create a second child to recover a failed name write.

Synthetic end-to-end execution (Node + real @icp-sdk/vetkeys, no canister access, no identities):

    cd frontend
    node --test scripts/prepare-icp-chatgpt-child-name-connector.test.mjs

### Important deployment / tool limitations

- This is an executable LOCAL Node bridge, not a new MCP method. The DFINITY ICP plugin still handles signing and all canister access, and cannot itself run arbitrary local JavaScript. A ChatGPT runtime with this repository and its installed dependencies is required to execute the bridge, or an independently reviewed, connected encryption tool would be needed.
- Source tests, synthetic encryption and actual live DEV access verification are necessary but do not prove a **new live child** is created, named and decrypted. No such write is permitted by this code or PR.
- The public key comes from a signed-in connector call but is not secret, and the node process never receives the user's Internet Identity delegation, passwords, signing keys or vetKeys. Its returned Candid arguments are ciphertext and can be sent by the existing connector only with separate write approval.
- The bridge is intentionally pinned to **Test3 and Group 2 ChatGPT Plugin Test U10**; it is a narrow DEV acceptance test, not a generic user onboarding implementation.


### Portable runner verified in ChatGPT (no extra plugin)

The [TEST] Secure ChatGPT private-name preparation workflow now packages the
locked Node dependencies and three local scripts into a short-lived GitHub
Actions artifact named ignite-dev-g2-child-name-offline-cli. CI executes a
synthetic encryption request using that detached package before uploading it.
No user names, Internet Identity delegations or canister writes enter CI.

The connected GitHub tool can retrieve the artifact and ChatGPT's container
can unpack and execute it with Node 22 without an internet npm installation.
This was verified in the live ChatGPT session on 15 November 2026: the official
DFINITY ICP connector provided the actual DEV Group 2 PII canister's public
96-byte verification key; the offline runner used a synthetic child ID and
synthetic name to produce a 263-byte IGSK1 clubchildren ciphertext and the
five expected Candid operations, with no plaintext in output and zero writes.

For an approved real child test, retrieve a reviewed matching artifact and
verify the Test3 app, Parent role, U10 team, Group 2 membership and empty child
inventory. Only after one-child approval call create_own_child once and
preserve the returned exact child receipt. Then use the offline helper with
the genuine tool responses and intended child name over private stdin; do
not put personal data in GitHub or any shell arguments. Separately approve
each canister write, verify registration ciphertext before grants/assignment,
and stop on ambiguous outcomes. Never create a duplicate child as recovery.

The DFINITY ICP connector remains the ONLY signer and canister transport.
The temporary offline runtime contains no keys or delegations, calls no
network endpoints and cannot write to PROD or send notifications. This is a
pinned DEV U10 acceptance tool, not a generic consumer onboarding plugin.
A future ChatGPT session may need to retrieve a fresh approved CI artifact.

### Approved direct-ICP boundary and offline-runner security

Owner approved this direction on 15 November 2026; see architecture decision #1532.
The **only authenticated canister transport** is the **official DFINITY ICP connector**.
The standalone Node script is an **offline local cryptographic calculation**.
It is not a hosted bridge/proxy and cannot sign canister requests. Do not
introduce an off-chain Ignite API, Supabase bridge, remote encryption server,
webhook or an alternative wallet session for this workflow.

- The runtime SDK modules are copied from the pinned frontend lockfile; the
  test workflow checks the detached package using only synthetic inputs.
- Both the installed and portable versions have source checks rejecting
  network API imports, dynamic execution, spawned child processes, use of
  environment variables, and console logging along the executable crypto path.
- The portable Node 22 test uses --experimental-permission and
  --allow-fs-read=<package-root>/; it does not grant filesystem writes or
  child-process execution. On newer Node versions --permission is an alias.
- **Critical limit:** Node 22 permission mode does not restrict outbound
  network connections. No-network behavior is a property of the reviewed code
  and pinned dependencies, not a complete OS-level network sandbox. Do not
  claim otherwise.
- Do not write the child's plaintext name or real signed connector receipts
  to source control, CI logs or workflow artifacts. A child's name given to
  ChatGPT is still visible to the ChatGPT service before local encryption.
- The current clubchildren IBE audience permits authorised **club members**
  to derive the shared club key, not only the child's parents. The native Ignite
  app uses this same policy; confirm it is appropriate before production use.
- Connector result JSON is not a cryptographic signature. Treat original
  direct tool responses as trusted only after checking the origin, caller and
  on-chain state; never replay a fabricated receipt.
- No real child creation, encrypted registration, grant or team assignment is
  part of this pull request. Each live update needs separate explicit approval
  and its own readback. No automatic retries following uncertain writes.

Restricted local execution pattern for an *already vetted package* (input is
private and supplied over stdin, not a shell argument):

    node --no-warnings --experimental-permission --allow-fs-read=<package-root>/ <package-root>/scripts/prepare-icp-chatgpt-child-name-cli.mjs

No merge or deployment of this PR has been performed as part of the security
review. DEV-only PII discovery already deployed separately; the broader
Candid exposure remains a distinct least-privilege review item.
