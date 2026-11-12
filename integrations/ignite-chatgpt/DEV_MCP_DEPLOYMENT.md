# Ignite-owned DEV MCP server and chat widget

**Status: server source and tests ready; NOT deployed; NOT connected to ChatGPT.**
No OAuth token exchange / stable Internet Identity delegation adapter has been installed.
The existing Ignite private plugin **v0.2.0** uses DFINITY ICP, not this server.
This branch is for review against DEV only; never merge to production based solely on source tests.

## Files
- `src/server.mjs`: stateless HTTP JSON-RPC MCP scaffold, tools/list, tools/call, resources/read, protected by injected OAuth bearer verification.
- `src/core.mjs`: strict caller-scoped read handlers and app-only `send_team_message`, requiring `ignite:chat:send`.
- `ui/my-ignite-live.html`: ChatGPT-compatibility MCP Apps view; direct `window.openai.callTool("send_team_message", ...)`, no follow-up ChatGPT user turn.
- `src/server.test.mjs`, `src/core.test.mjs`, `src/overview.test.mjs`: Node's built-in tests.
- `.github/workflows/ignite-chatgpt-dev.yml`: verifies source and runs tests on PRs.
- `ui/my-ignite-prototype.html`: fictional sample-data exploration; do not use for actual member messaging.

## How it works
1. ChatGPT calls the model-visible `open_my_ignite_chat` tool with a selected authorized club, team and conversation.
2. The server verifies the caller session and authorizes the exact chat, reads the newest 20 messages, and returns a verified structuredContent object.
3. MCP Apps hosts render the HTML resource `ui://ignite/my-team-chat-v1.html` through `_meta.ui.resourceUri` (ChatGPT compatibility alias `openai/outputTemplate`).
4. The widget displays the actual message history and calls the app-only `send_team_message` directly when a member taps Send. It does NOT send a ChatGPT follow-up message.
5. The handler rechecks access + posting permissions, validates the text and request UUID, and uses a caller-signed ICP actor through an injected backend. The canister checks its own membership, admin-only posting and idempotency rules.
6. The tool returns an authoritative server result; the widget refreshes the chat in-place. Uncertain outcomes are explicitly unconfirmed and never automatically retried.

The `send_team_message` descriptor must retain `_meta.ui.visibility=["app"]`. This is a **host presentation boundary only**; the server must enforce OAuth scopes and all member permissions regardless of the tool's visibility.

## Authentication requirements before any deployment
The dedicated Ignite connector **cannot inherit the DFINITY connector's Internet Identity grant**. Implement, review and test a dedicated authorization server:
- OAuth Authorization Code + PKCE, protected resource metadata, correct issuer/audience and signature validation (JWKS or introspection), expiry and refresh-token rotation where supported by the provider.
- Explicit user consent for `ignite:read` and separately `ignite:chat:send`; token scopes validated by the server, not the UI.
- Account linking / delegation between OAuth identity and member-owned Internet Identity for the exact DEV derivation origin `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app`.
- Per-request verified session: `{oauthVerified:true,internetIdentityDelegationVerified:true,environment:"dev",derivationOrigin:DEV_ORIGIN,principal,actorFactory,scopes}`.
- Strict revocation and expired-credential handling. Re-prompt on actual invalid credentials; don't prompt just because the user opens another chat.
- Never use admin canisters, a service principal, anonymous fallback, account IDs from tool arguments, raw bearer tokens passed through the widget, or untrusted session flags from a request body.

## Backend adapter contract
A reviewed `backend` must provide these methods using the signed-in caller's actual delegation and per-club group routing:
`getProfile, listMyClubs, hasClubAccess, hasTeamAccess, listMyTeams, listEvents, listConversations, hasConversationAccess, listConversationMessages, canPostToConversation, sendConversationMessage`.

`sendConversationMessage(session,club,team,conversation,body,idempotencyKey)` calls the assigned DEV `messaging_domain.send_message(conversation_id,body,idempotency_key,null,null)`; it must unwrap Candid Ok and throw Err, and **must not provision a chat or auto-retry an uncertain send**. Return the authoritative message including ID, sender, exact body, conversation ID and idempotency key. Use the same identity/delegation on every read/write. On unknown outcomes, keep the key for recovery, rather than generating a new key to retry.

## Launch
The server's startFromEnvironment requires both:
- `IGNITE_OAUTH_ADAPTER_MODULE`: an importable JS module exporting `verifyBearerToken(token, context)`.
- `IGNITE_ICP_ADAPTER_MODULE`: an importable JS module exporting a caller-scoped `backend`.

Startup refuses to run when modules are missing. Launch after both are reviewed, tested and configured:
`node integrations/ignite-chatgpt/src/server.mjs`

The scaffold listens only on 127.0.0.1 and expects a secure HTTPS reverse proxy and a real OAuth discovery implementation. Do not expose it publicly as-is. Host SDK integration and MCP Apps standard `@modelcontextprotocol/ext-apps` bridge should be validated through actual ChatGPT developer-mode tests; this source currently uses the ChatGPT-compatible `window.openai` bridge, **not** the portable SDK.

## Deployment gates
- [x] MCP source, resource and protected app-only send tool implemented on dev branch.
- [x] Tests cover HTTP auth gate, wrong conversation, read scope, write scope, sample send and fail-closed startup.
- [ ] Real DEV OAuth and Internet Identity delegation bridge implemented.
- [ ] Caller-scoped multi-group ICP backend adapter implemented.
- [ ] Live widget integrated and verified inside ChatGPT Android, web and iOS.
- [ ] Parent/coach pilot tests, revoked session tests, duplicate-tap and network-uncertain tests.
- [ ] Actual end-to-end send confirmed via the new Ignite-owned transport, with measured latency.
- [ ] Deployment security audit and privacy check for junior sports data.
- [ ] Public distribution and production rollout separately authorized.

## Verification
`node --test integrations/ignite-chatgpt/src/*.test.mjs`

Source CI success does not establish end-to-end app connectivity, OAuth readiness, or production safety.


## Authentication and ICP integration source added — 13 Nov 2026

Implemented (source only):
- `src/oauth-verifier.mjs`: pinned HTTPS issuer/JWKS, RS256 signature checks, audience, expiry, issue time, scope checks, and separate trusted Internet Identity delegation lookup. It never trusts principal, roles, actor keys or scope claims sent from the chat UI.
- `src/oauth-entrypoint.mjs`: refuses import unless the issuer, JWT resource audience, JWKS URL and trusted delegation registry module are configured.
- `src/icp-backend-adapter.mjs`: caller-signed per-member methods for clubs, teams, chat listing/history, posting-policy checks, and the exact one-write send operation; refuses unknown / non-DEV club placements.
- `src/icp-entrypoint.mjs`: refuses import unless a trusted group-discovery and club-placement module is configured.
- Independent synthetic tests cover forged JWTs, wrong audiences, expired delegations, unauthorized chat rooms, missing membership data, admin-only posting and one-write behavior.

**These additions are not an OAuth provider or an Internet Identity delegation service.** They require an external trusted authorization server, member consent, a secure delegation registry, a continuously available deployment environment, and independently verified routing/actor acquisition. Never create a synthetic user or admin identity to circumvent those requirements. The existing DFINITY ICP plugin grant cannot be exported or silently reused.

### Server environment configuration

```text
IGNITE_OAUTH_ADAPTER_MODULE=./oauth-entrypoint.mjs
IGNITE_ICP_ADAPTER_MODULE=./icp-entrypoint.mjs
IGNITE_DEV_OAUTH_ISSUER=https://<trusted-dev-authorization-issuer>
IGNITE_DEV_MCP_AUDIENCE=https://<trusted-dev-mcp-endpoint>/mcp
IGNITE_DEV_OAUTH_JWKS_URL=https://<trusted-dev-authorization-issuer>/.well-known/jwks.json
IGNITE_DELEGATION_REGISTRY_MODULE=<absolute-module-url-of-verified-registry>
IGNITE_DEV_ROUTING_ADAPTER_MODULE=<absolute-module-url-of-verified-router>
```

The angle-bracket entries are **placeholders**, not usable URLs or claim of an installed authorization service. The two adapters must be fully audited. No secrets or delegated private keys should appear in GitHub or ChatGPT chat logs.

### Critical derivation-origin acceptance gate

The DFINITY DEV connector resolves `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app` and has been confirmed under the Paul test principal. The existing native application source, however, defines `DEV_FRONTEND_II_ORIGIN = "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io"`. They are different origin STRINGS. Although ICP frontend aliases can support alternate origins, **do not assume** the authorization server will derive the same principal: test the exact effective principal from both flows, with a consenting non-admin user, before authorizing any sends. Fail closed on mismatch. The current prototype pins the connector's observed `ic0.app` origin and must not automatically change it.

### Remaining implementation gates

- [ ] Customer-account Internet Identity login flow and explicit delegation to Ignite-owned connector (cannot borrow DFINITY's grant).
- [ ] OAuth Authorization Code + PKCE provider with persistent refresh/revoke behavior and client registration; the verifier only validates existing access tokens.
- [ ] Trusted encrypted member-delegation storage or a safe user-device signing alternative; never centrally store unrestricted private keys.
- [ ] Production-quality signed per-club placement lookup, service allowlist, and consistent effective principal on both DEV groups.
- [ ] HTTPS MCP endpoint deployment + public OAuth resource/authorization metadata, developer-mode plugin connection.
- [ ] Host-verified MCP Apps SDK bridge on Android and web, direct send observed without any generated ChatGPT turn.
- [ ] Real member/coach end-to-end security and performance tests.

**Do not deploy the source-only HTTP scaffold as a public endpoint yet.**
