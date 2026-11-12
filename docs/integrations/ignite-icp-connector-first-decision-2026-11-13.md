# Ignite ChatGPT: official ICP connector-first decision
Date: 2026-11-13 · Status: **architectural decision and support questions**, not deployment approval

## Verified facts

- Existing private Ignite DEV ChatGPT plugin depends on the official DFINITY Internet Computer plugin through `.app.json` using app ID `asdk_app_6acc9f589e548191a4ffa5a30842ac2d`.
- With a user-approved Paul ICP connection, ChatGPT successfully read authorized DEV team chat history, rendered a poll and sent one text message via `messaging_domain.send_message`, with a confirmed readback.
- Team data exists across DEV Groups 1 and 2. Authorized caller-scoped reads and writes operate through the DFINITY connector and existing canister permissions.
- Current plugin is **skills-only**: it cannot itself serve an MCP Apps `ui://` resource or place a direct `callServerTool` handler inside a persistent widget.
- MCP Apps tool visibility is **per-server**. An app-only tool (`_meta.ui.visibility=["app"]`) can be called by an app from **the same server connection only**. Cross-server app-only calls must be rejected. See https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#tool-visibility and https://developers.openai.com/plugins/concepts/mcp-server.
- A plugin dependency makes its tools available to the model, **not** to an arbitrary different plugin's embedded iframe. See https://developers.openai.com/plugins/build/skills and https://developers.openai.com/plugins/plugin-guidelines.
- The protocol does not establish a supported way for an Ignite-owned UI to silently reuse the DFINITY plugin's Internet Identity delegation or invoke its app-only tools. This is a platform integration limitation, **not a failed connector sign-in**.
- The official DFINITY connector is a remote component with its own infrastructure and security assumptions. Avoid saying that no intermediary or operator attack surface exists.

## Decision

**Do not deploy the standalone Ignite OAuth/II delegated-key bridge from draft PR #1495.** It would introduce an additional user-signing trust boundary that conflicts with Ignite's preference to minimize intermediaries for member-private chat, especially children's data.

Retain the existing DFINITY-dependent skills-only plugin as the DEV baseline. Optimize its member-facing UX while DFINITY and/or OpenAI confirm whether an approved joint integration is possible.

## Supported options now

1. **Connector-native ChatGPT flows (working):** ChatGPT uses DFINITY ICP tools to read and send on the member's existing authorized connection; native chat inputs/buttons may issue a short user-visible turn. Trust boundary: DFINITY connector + ICP canisters; no Ignite-owned delegations. This is **not** zero-latency or a persistent iframe chat.
2. **Open Ignite app for fast everyday messaging (working route):** links or deep links open the Ignite native/web UI, which already signs writes via the user's local Internet Identity session. The ChatGPT plugin remains useful for finding teams, summarizing and making occasional confirmed actions.
3. **DFINITY-hosted same-server MCP App (conditional):** DFINITY could expose a purpose-built Ignite chat UI resource and app-only, scoped tools under its **own** ICP MCP server connection, preserving the connector's user authorization. Requires DFINITY product work and permission review.
4. **Explicit host-mediated cross-plugin delegation (conditional):** OpenAI could offer a reviewed, user-consented, capability-scoped API by which a widget requests another installed connector's specific tool without exposing credentials or breaking server isolation. **Not present in the documented standard**; do not implement an iframe bypass.
5. **ICP canister-mediated signing with non-exportable client keys (research):** explore whether a client-owned signing flow could work within ChatGPT without storing user identity keys on an Ignite bridge. Do not promise this will be supported by sandboxed host interfaces.

## Questions to save for DFINITY

1. Does the DFINITY ICP MCP app support, or plan to support, MCP Apps UI resources and app-only tools **within its existing server**?
2. Could it expose app-specific scoped tools such as `ignite.list_team_messages`, `ignite.send_team_message`, `ignite.set_my_rsvp`, all under the same existing verified principal and per-canister membership checks?
3. Can a client-hosted Ignite chat widget be registered as a **UI resource belonging to the DFINITY server**, so `callServerTool` goes back to that server, without exporting member delegations?
4. Are there documented permission scopes narrower than the current broad **Actions & questions** consent, and can the member approve only team-message sending?
5. Can the connector reuse a valid authorization across multiple team messages without new II prompts, and what triggers forced reauthentication? What can DFINITY log, cache, decrypt or sign?
6. Does the connector support pagination, poll cards, attachment previews, RSVP and asynchronous message updates efficiently, and are there performance targets or streaming notifications?
7. Is it possible to publish an Ignite-branded plugin that depends on DFINITY's connection and embeds a DFINITY-owned MCP Apps view under OpenAI's review rules?
8. Can DFINITY provide a sandbox/test connector with fresh non-admin accounts, Groups 1 and 2, and no elevated operator rights for the pilot?

## Questions to save for OpenAI

1. Does a dependency-based skills plugin have any host-supported way to display an owned MCP Apps UI while using a different plugin's existing tool authority?
2. Is a user-consented, cross-plugin capability delegation or hosted iframe tool invocation available or planned? The MCP Apps specification currently forbids direct cross-server app-only calls.
3. Can a first-party ICP connector host an Ignite-specific UI resource and app-only tools and have that view selected through Ignite's dependent plugin?
4. What Android/iOS support exists for persistent MCP Apps chat views, real-time updates and direct Send interactions without a new chat turn?
5. Can a provider suppress redundant reauthorization and handle narrow write permissions while keeping all signing credentials inside the existing connected provider?

## Immediate DEV UX changes that do not weaken security

- Before sending, show a small readable composer and recipient, with a user-confirmed **Send** button; no UUIDs, canister IDs or JSON in customer chat.
- An approved Send action submits a short human-language request (the model must still invoke the connector). Never claim an in-place one-tap send.
- During an existing verified thread, reuse the bound app/origin/principal and selected destination as *routing context* while the canister itself checks **current** membership and posting permissions at write time.
- Avoid repeated identical club/team/history reads within one send, but verify exact returned sender, room, body and idempotency key; read back on success. Never retry uncertain sends automatically.
- If the ICP connection is healthy, never request reinstall or reconnection. If it fails, report the provider's actual requirement and do not bypass it.
- Keep the DEV private pilot; PRODUCTION, RSVP writes, media sends and unreviewed broadcast tools remain disabled.

## Next acceptance gate

A demonstration of an **actual DFINITY-owned MCP Apps widget** that can invoke a narrowly scoped send operation on its own authenticated ICP connector connection, **or** a documented OpenAI host-mediated alternative. Until then the connector-native ChatGPT UI is a supported fallback, and the native Ignite app is the fast full chat client.
