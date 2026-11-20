# DFINITY / OpenAI integration request: secure Ignite profile form inside ChatGPT

**Status:** Technical-review proposal, NOT a deployed MCP App or public release. 20 Nov 2026.

**Scope:** One customer-owned DEV encrypted display-name record. No PROD data, second OAuth/Internet Identity provider, signing proxy, plaintext-name transport, bridge server, real ads or checkout.

## Decision required from DFINITY

Can the **existing official DFINITY ICP MCP server**, already used by the Ignite private ChatGPT plugin, sponsor an Ignite-branded MCP App UI **inside ChatGPT**, and allow the component to use the **same linked Internet Identity session** for explicitly authorized, signed canister calls? Does it support a UI-only trusted tool path and keep the name out of chat/tool transcripts and server diagnostics?

The MCP Apps protocol permits an iframe to call tools on its **sponsoring MCP server**. It does **not** guarantee automatic cross-plugin invocation of authenticated tools. We cannot infer cross-plugin `callTool` support.

References:
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/reference
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

## Proven starting point — not live acceptance

- The private Ignite ChatGPT plugin remains bound to the existing official DFINITY app, ID `asdk_app_6acc9f589e548191a4ffa5a30842ac2d`. There is **no custom Ignite signer or MCP server**.
- Canonical DEV app: `https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net`; II derivation origin: `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app`.
- DEV identity: `mq2sj-fiaaa-aaaal-qxlqa-cai`; original adult-name PII authority currently `iui5p-aaaaa-aaaal-qxllq-cai`. Before any signed operation, the real identity canister MUST independently return its configured original authority through `read_secure_name_authority()`. A copied constant is not authorization.
- Original SDK implementation: `frontend/scripts/prepare-icp-chatgpt-private-name.mjs` using pinned `@icp-sdk/vetkeys`. IBE identity is UTF-8 of `principal + U+001F + "display_name"`; reference format `pii-display-name:v1:<PII canister>:<principal>`.
- Synthetic-only standalone form proof: `frontend/prototypes/chatgpt-vetkeys-name-poc/`, PR #1625. It has no Internet Identity, PII signing, network access or ChatGPT iframe bridge.

## Expected workflow if DFINITY supports this safely

1. **Authenticated preflight.** Official connector resolves canonical app, derived Internet Identity principal, identity canister, active session and original PII canister. Recheck against freshly declared `/.well-known/ic-architecture`. Refuse wrong/anonymous/expired principal or changed origin/authority; never fall back to PROD or another group.
2. **Official UI resource.** DFINITY provides a versioned `ui://` resource and a tool whose metadata includes `_meta.ui.resourceUri`. Resource MIME type is `text/html;profile=mcp-app`; resource-level `_meta.ui.csp` restricts allowed domains. The UI runs in a trusted ChatGPT host sandbox. Do NOT infer that an unrelated standalone Ignite iframe may call the DFINITY connector.
3. **Public key.** The widget receives the original PII public verification key from the same authenticated, trusted connector session (`pii_vetkey_verification_key()`). Validate provenance, length and binding; do not accept arbitrary browser-supplied PII sinks.
4. **Local input and encryption.** Customer types their real name into the private widget, **not the chat text box**. Validate 1–80 Unicode characters, at most 512 UTF-8 bytes, no control characters. Using the existing SDK, encrypt on-device for `principal + U+001F + display_name`. No plaintext in MCP arguments, model-visible responses, analytics, logs, browser storage or remote encryption endpoint. Never reuse the synthetic fixture principal/key.
5. **One signed write.** With user approval, connector submits `register_pii(principalText, "display_name", ciphertextBytes, principal)` to the exact PII authority, using the customer's existing Internet Identity. No delegated-key export or proxy signer.
6. **Authenticated crypto readback.** Connector reads owner ciphertext via `get_encrypted_pii_batch` and the owner-authorized encrypted VetKey via `get_encrypted_pii_vetkeys_batch` using a widget-generated ephemeral transport public key. Widget keeps the transport secret locally, uses `EncryptedVetKey.decryptAndVerify` and `IbeCiphertext.decrypt`, and independently compares decrypted text to the entered name. Exact ciphertext, field, subject and scheme must match.
7. **Publish reference once.** Only after verification and separate approval, signed `identity_access.set_profile(private-name-reference, null)`; read back `get_profile()` to confirm reference. Do not write a plaintext display name or bypass the existing secure-name gate.
8. **Separate legal consent and next steps.** Verify actual current Terms/Privacy release, request independent explicit consent, signed `set_terms_acceptance(version)`, verify readback; then Free plan club and team placement through existing router. A form render or successful encryption is NOT legal consent or completed signup.
9. **Unknown outcome recovery.** On timeout, lost reply, revoked session or changed authority, inspect existing ciphertext/profile with the SAME customer before deciding on further action. Never automatically retry `register_pii`, create a second account, or claim success. Fail closed if decryption or authorization is unavailable.

## Questions DFINITY should answer

1. Can its official MCP server sponsor/review a third-party Ignite `ui://` resource, including ChatGPT desktop, Android and iOS, and preserve existing branded-plugin ownership?
2. Which *same-server UI-accessible* tools supply verified principal, original PII authority, public key, signed `register_pii`, owner ciphertext and VetKey reads and signed `set_profile`? Are all scoped to one app and verified principal?
3. Will UI `tools/call` always execute as the **current signed-in Internet Identity**, with human approval for updates? How are account switching, re-auth and expiration communicated?
4. Can tool responses be **UI-private** so real plaintext, decrypted bytes, transport secrets, and sensitive receipts never appear in model-visible content or server logs? What telemetry/logging is unavoidable?
5. What exact `_meta.ui.csp` and WASM/script policies are supported in ChatGPT, including the SDK crypto runtime? Can network tracing confirm no plaintext egress?
6. If no UI resource can be sponsored, is there a separately *documented and audited* arrangement to use DFINITY's authenticated operations without another signer? Do not assume cross-plugin `callTool` is allowed.

## Acceptance gates

| Gate | Required result |
| --- | --- |
| Standalone form | Original SDK, synthetic-only browser test, no off-origin traffic, hidden controls refused, no data persistence |
| Disposable real crypto | PocketIC PII and identity canisters: encrypted registration under synthetic owner, exact readback, real authenticated VetKey decrypt, tamper/stranger denial, profile reference, separate consent |
| Trusted UI binding | Current principal, derivation origin, canister and public-key provenance fresh and unchanged across encryption, approval, write and decrypt |
| Privacy | No real name enters chat, tool arguments, analytics, persistence, logs, secret transport or unapproved endpoints |
| Connector update | One approved signed original-PII write; expired/wrong-identity/unknown outcomes fail closed; no proxy, bridge or new credentials |
| Final acceptance | Authenticated profile readback, independently approved legal release, full new-customer onboarding on desktop and mobile, DFINITY/OpenAI review |

**Ignite can complete independently:** all standalone validation, real disposable-PocketIC crypto rehearsal, negative tests, UX specifications and protocol contract. **DFINITY/OpenAI authorization remains required** for a trustworthy hosted in-chat UI bound to the official signer and publishing path.

**No-go:** A green browser/PocketIC test does not establish secure customer onboarding inside ChatGPT. If the existing connector cannot sponsor an approved UI or vetted equivalent, this scope remains BLOCKED rather than being replaced by a plain-chat form, external app redirect or private signing bridge.
