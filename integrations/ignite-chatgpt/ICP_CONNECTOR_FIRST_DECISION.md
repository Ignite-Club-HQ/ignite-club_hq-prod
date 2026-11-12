# Architecture decision: ICP connector first for Ignite ChatGPT (2026-11-13)

**Decision: DFINITY's official Internet Computer (ICP) connector remains the preferred authenticated path for Ignite DEV and future customer-facing ChatGPT workflows.** The alternative Ignite-owned OAuth/MCP delegation bridge in PR #1495 is **ON HOLD / NOT APPROVED FOR DEPLOYMENT**.

## Why

We have already demonstrated, with the authenticated owner's DEV account, that DFINITY's connector can discover the Ignite DEV application, resolve an Internet Identity for its declared derivation origin, read memberships from two DEV groups, retrieve team messages and polls, and write exactly one user-confirmed test message with canister idempotency and readback. A separate Ignite-operated bridge would add a new credential and attack surface—especially sensitive because junior club chat and files can contain children's information.

**Nuance:** DFINITY's ICP MCP connector is itself an MCP intermediary, hosted by DFINITY and using user-approved Internet Identity delegations. It is not a raw browser-to-canister session. It does, however, avoid Ignite becoming custodian of a second centralized user-delegation broker.

## Approved architecture now

ChatGPT + Ignite Club HQ skills/plugin UX
  -> dependency on official DFINITY Internet Computer (ICP) connected app
  -> caller-authorized, declared Ignite DEV canisters on ICP
  -> existing server-side identity, club, team and chat authorization

The existing private Ignite DEV plugin v0.2.0 already declares the DFINITY app ID via `.app.json`, with supported chat history, confirmed sending and club/team discovery. Keep it as the primary functional pilot. No app-admin, service-principal or duplicate OAuth linkage.

## Current verified limitation

OpenAI's MCP Apps UI mechanism is returned by an MCP server and invokes tools using the MCP Apps `tools/call` / `callServerTool` bridge. The documentation demonstrates invoking tools exposed by *that server*. We have NOT verified a supported method for a custom Ignite-owned widget to invoke authenticated tools owned by the **separately connected DFINITY ICP MCP server** directly, retaining that connector's identity grant.

Do not claim an Ignite widget can reuse ICP MCP's authorization or call its tools directly. An Ignite-owned server pretending to proxy those calls would reintroduce bridge risks. Do not deploy that.

Current safe options:
1. **Use ChatGPT's native generated controls and conversations** with the existing DFINITY-connected plugin. This supports real read/write operations and user confirmations, but a Send tap submits a new ChatGPT turn; neither host progress UI nor connector authorization prompts can be suppressed by skill instructions.
2. **Ask DFINITY about first-party ICP MCP MCP Apps support**: app-defined UI resources, per-app domain-specific tools, app-only Send and RSVP tools, verified scoped grants, faster multi-call aggregation/transactions, and control of reauthentication UX.
3. **Prototype an ICP-hosted, directly signed UI** only after checking ChatGPT iframe capabilities and whether Internet Identity can be used directly in that sandbox with the same app principal. Such a separate session would NOT silently inherit the DFINITY grant. Treat as feasibility investigation, not a product commitment.

## Security acceptance gates

- Keep individual user Internet Identity grants time-limited and user-revocable, via DFINITY's official consent flow.
- Enforce authorization in canisters (per-club/team membership, chat posting, owner/parent RSVP), not only in instructions or client-side controls.
- Never export, mirror or store DFINITY connector grants in an Ignite-hosted OAuth/MCP bridge.
- A user chat Send operation must target exactly one selected, authorized DEV team chat, use a fresh idempotency key, and verify canister result; no retries after uncertain outcomes.
- No PROD calls or canister upgrades as a side effect of plugin development.
- For customer deployment, obtain a concrete technical mechanism for rich UI + fine-grained writes (and security review) rather than describing generic ICP update access as tightly scoped.
- Run a real non-admin parent/coach journey and test revocation, expiry, role restrictions and cross-group routing.

## Questions to send DFINITY ICP MCP maintainers

1. Can the official connector expose a per-app MCP Apps UI resource that renders an Ignite team-chat widget while the official connector remains the sole holder of the II delegation?
2. Can `callServerTool` from an embedded UI call the connector's authenticated `canister_update_call` / `canister_query` without generating an additional ChatGPT model turn? What authorization boundaries does the host enforce?
3. Could ICP MCP register typed, app-specific tools (e.g. `ignite.send_team_message`, `ignite.set_rsvp`, `ignite.get_chat_page`) that reuse the existing member-specific grant and declarative canister manifest, rather than requiring generic Candid calls for every interaction?
4. Are narrower grant scopes possible (per canister/method, read vs write), and how can a plugin avoid repeated OAuth prompts while respecting user-chosen expiry/revocation?
5. Does ICP MCP support query/update aggregation, low-latency streaming, or a dedicated canister API method to reduce model-orchestrated multi-call send workflows?
6. Is there an official development extension point for branded plugins depending on ICP MCP? If no, is this on the roadmap, and would DFINITY collaborate on a secure implementation?

Contact: https://internetcomputer.org/icp-mcp/support/ ; official project: https://github.com/dfinity/imcp2

## PR #1495 treatment

The Ignite-owned MCP server, JWT verifier, OAuth account linker, delegation registry interfaces and signed per-user ICP adapter were written as **source-only prototypes**. Keep the draft PR available for reference and automated tests but **do not merge, deploy, select a hosted OAuth provider, register the endpoint, or collect new user delegations** under that architecture without a fresh explicit security/design decision.

The related read-only My Ignite overview PR #1494 remains relevant to customer UX research, but should not be treated as proof an embedded UI can call a different MCP server.

References:
- https://internetcomputer.org/icp-mcp/
- https://github.com/dfinity/imcp2
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/concepts/plugins
