# Ignite ChatGPT-only private display-name onboarding (DEV)

**Status:** source-only crypto helper and contract tests. **Not yet wired into an executable ChatGPT MCP App view or ChatGPT encryption tool.** Do not claim the customer's name is saved or send them to the Ignite website as a workaround.

## Why the existing connector isn't enough

The official DFINITY ICP connector can authenticate Test3's real Internet Identity and call declared Candid methods. The current Ignite secure-name release requires an identity-based encrypted ciphertext **before** `pii_access_control.register_pii` and `identity_access.set_profile`. The native Ignite frontend calls `preparePrivateOwnProfileName()`, which encrypts with `@icp-sdk/vetkeys` in the client runtime. There is no equivalent general-purpose encryption action in the current ICP connector.

The needed additional UI is **inside ChatGPT**: a client-side MCP App or host crypto action. It must run the already-pinned `@icp-sdk/vetkeys` library within the user's trusted ChatGPT client view and return only ciphertext / immutable canister parameters to the model. A generic remote plaintext-to-ciphertext microservice would leak user names to a new third party and is not the preferred implementation.

## Source support

- `frontend/src/live/chatgptOwnNamePolicy.mjs`: exact DEV app URL, derivation origin, original PII sink and identity access, signed-caller equality, canonical principal, name length/control-character validation, original authority reference, IBE identity. Used before any encryption.
- `frontend/src/live/chatgptOwnNameCrypto.mjs`: **pure, browser-side encryption helper** for the in-chat view. Input must include independently verified public `pii_vetkey_verification_key` bytes from that exact canister, not caller-supplied key material. Uses `DerivedPublicKey.deserialize`, `IbeCiphertext.encrypt`, `IbeIdentity.fromBytes(principal + "\\u001F" + "display_name")` and `IbeSeed.random`. Emits only ciphertext bytes and immutable owner, field, canister, reference identifiers; no plaintext, private keys or delegations in output.
- `scripts/chatgpt-own-name-crypto-contract.test.mjs`: source and preflight validation; does **not** prove actual mainnet encryption or a live ChatGPT view.

## Required in-chat workflow after a trustworthy crypto view is published

1. Select the actual connected Test3 DFINITY link, call `open_app("https://ignite-club-launchpad.lovable.app")` and `get_app_principal`, verify exact DEV origin and signed caller.
2. Read `identity_access.whoami()`, `get_profile()`, `read_secure_name_authority()` (signed update read) to verify registered account, profile state, and exact original PII canister. Don't accept a manually typed arbitrary authority.
3. Read `pii_access_control.pii_vetkey_verification_key()` from the **declared PII canister**, and supply those bytes into the in-chat crypto view without treating the public key as a secret. Validate the signed principal and user-approved display name (for this Test3 rehearsal, `Test3`).
4. The view encrypts `Test3` on-device, producing `pii_id=principal`, `field_id="display_name"`, `domain_owner=principal`, `ciphertext=vec nat8` and `profile_reference="pii-display-name:v1:<authority>:<principal>"`. The view should show the name and exact action for explicit user approval but not expose name in tool logs.
5. Through **official DFINITY connector as Test3**, submit one `register_pii` call to the original DEV PII canister only. Read back the ciphertext through `get_encrypted_pii_batch` under Test3's own authority and verify exact bytes and key scheme.
6. For full cryptographic verification, perform the existing in-client `get_encrypted_pii_vetkeys_batch` / random `TransportSecretKey` / `EncryptedVetKey.decryptAndVerify` / `IbeCiphertext.decrypt` under the same live caller, then compare UTF-8 plaintext to `Test3`. This must be a trusted in-chat client crypto operation with no secret disclosure.
7. Through the same official signed connector identity, publish `identity_access.set_profile("<original secure-name reference>", null)` **once**, then independently read `get_profile` and confirm the exact saved reference, not just an Ok acknowledgement.
8. Explicit separate legal agreement to owner-approved Terms/Privacy release `2026-11-13` must still be requested from the consenting Test3 identity. Never interpret name approval or account registration as legal consent.
9. Only then proceed to safe routed DEV club/team creation, never PROD. Never create a second club on error or bypass placement.

If any attempted write has an unknown outcome, **read back the exact original record before another write**. Do not send private usernames or encryption material to unrelated tools; never ask for II seed phrases.

## Acceptance before we can call this finished

- The actual in-chat crypto control is published and accessible to the current ChatGPT plugin.
- The full browser/view crypto round trip matches the already-shipped Ignite app's IBE ciphertext format.
- Test3's encrypted private name, signed stored ciphertext, locally decrypted readback, and saved profile reference are all verified in DEV.
- Negative tests: wrong principal/sink/origin, invalid public key, wrong ciphertext, missing signature, lost writes; no effect on PROD; no plaintext fallback.
- Real customers do not have to leave ChatGPT.

Tracking: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/issues/1511
