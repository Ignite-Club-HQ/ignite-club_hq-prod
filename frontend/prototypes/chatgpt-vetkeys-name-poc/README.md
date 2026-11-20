# DEV proof: encrypted name entry for a possible Ignite ChatGPT widget

**Status:** Browser-only synthetic proof. **NOT embedded in ChatGPT. NOT a registration workflow. NOT production-ready.** Do not enter real names, passwords, Internet Identity credentials, recovery keys or other personal data.

## Why this exists

Ignite already encrypts private names *on-device* using \`@icp-sdk/vetkeys\` and writes ciphertext to the original PII canister. The canister is **not** an automatic plaintext-encryption endpoint, and ChatGPT's private plugin is currently a **skills layer** attached to DFINITY's existing official ICP MCP plugin. Typing a real name as ordinary chat text would process plaintext through ChatGPT before client-side encryption.

This experiment demonstrates that the **existing** \`prepareEncryptedChatgptProfileName\` function can run in a browser-only entry screen. It does **not** demonstrate a private UI inside the ChatGPT iframe or a signed canister write.

## What the proof actually does

- Uses an invented sample name and a fixed **synthetic test principal/public verification key** from Ignite's existing crypto tests; the original DEV PII canister ID is used only as a scheme identifier.
- Imports the **same original** \`@icp-sdk/vetkeys\` implementation from \`frontend/scripts/prepare-icp-chatgpt-private-name.mjs\`. Identity bytes remain \`principal + "\\u001f" + "display_name"\`; encryption uses existing IBE.
- Produces a ciphertext **in local memory only**, checks the plaintext is not embedded in its Candid arguments, and returns a display-only success bit and ciphertext byte count.
- Does not expose the name, ciphertext, derived keys or Candid arguments to the DOM or tool outputs; makes no \`fetch\`, MCP call, signing call, \`postMessage\`, storage write or canister update; it discards its ciphertext buffer after the proof.
- HTML adds a restrictive development CSP including \`connect-src 'none'\` and \`form-action 'none'\`. A real MCP Apps resource must separately declare the equivalent \`_meta.ui.csp\` restrictions (and verify effective browser/network behaviour).
- Does not require changing or duplicating Ignite's original adult-name authority, per-club name-key scheme, parent/child permissions, or any existing registered profile.

## Run locally with **synthetic data only**

After the repository's pinned \`frontend\` dependencies are installed:

\`\`\`sh
cd frontend
node --test scripts/chatgpt-vetkeys-name-poc.test.mjs
node node_modules/vite/bin/vite.js build --config prototypes/chatgpt-vetkeys-name-poc/vite.config.mjs
\`\`\`

The built static output is under \`frontend/prototypes/chatgpt-vetkeys-name-poc/dist/\` and is **not** part of the Ignite frontend or automatic DEV deployment. Only inspect the proof locally or in a controlled test browser. CI must not upload real names or keys.

## Critical ChatGPT integration gate

OpenAI's documented MCP Apps UI resources belong to an MCP server and use a hosted iframe bridge. An Ignite UI **is not automatically permitted to invoke DFINITY's separate authenticated tool** simply because the Ignite skill's \`.app.json\` references the existing official plugin. Do NOT invent a cross-plugin \`callTool\`, introduce an Ignite signing proxy, route Internet Identity credentials through a custom backend, or send the entered name through \`sendFollowUpMessage\` / model-visible structured content.

An acceptable in-ChatGPT architecture must be verified with DFINITY/OpenAI:

1. The **official DFINITY connector**, or an explicitly supported secure UI arrangement, opens the approved iframe after validating the current Internet Identity principal and exact original PII authority.
2. The trusted component receives the original **public** VetKeys verification key and identity binding through a verified provenance channel, not manually pasted JSON or a guessed canister.
3. The name never enters model/tool arguments, resource logs, browser storage or analytics, and encryption happens on the device using the existing SDK.
4. The component uses only an **authorised signed ICP update path provided by the official DFINITY connector** to submit ciphertext to the original PII canister. The component cannot sign as another account, and approval is given for the actual record.
5. Independently read ciphertext back and decrypt under the authenticated customer's own authorised vetKey; publish exactly one immutable private-name reference only after that verification.
6. Confirm clean installation and browser network traces on desktop, iOS and Android. A static CSP/unit test alone is not proof that a production iframe is secure.
7. Test refusal/recovery for expired grants, changed origin, wrong PII authority, duplicate record, unknown write result, denied VetKeys read and malformed input.

**Go/no-go:** This POC may pass without any live ICP writes, but public ChatGPT-only onboarding remains **BLOCKED** until the verified user-bound widget/tool handoff exists. Continue to use the existing Ignite app-side secure-profile flow where appropriate rather than weakening its encryption.

Primary issue: [#1511](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/issues/1511). Public plugin delivery needs separate DFINITY/OpenAI agreement.
