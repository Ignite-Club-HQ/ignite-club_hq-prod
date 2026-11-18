# Ignite ChatGPT plugin — DFINITY-hosted MCP reuse experiment

**Status:** experimental package; **not installed or published**, no server or canister deployment, and no production writes.

## Architecture

```
ChatGPT [Ignite Club HQ plugin]
     |
     | OAuth / Internet Identity via DFINITY
     v
https://mcp.internetcomputer.org/mcp  (DFINITY-operated)
     |
     | user's approved delegation; discover opted-in app
     v
https://igniteclubhq.app  ->  existing ICP canisters
```

The plugin's `mcp.json` points directly at DFINITY's **existing** MCP endpoint. The OAuth config prefers CIMD and its DCR fallback, as supported by DFINITY's open-source `imcp2` and OpenAI plugin packaging. This path avoids building or hosting a second MCP server. It does not reuse a previous **installed plugin's authentication session**: the user must explicitly authorise the Ignite-branded plugin.

The onboarding skill tells ChatGPT to first discover `https://igniteclubhq.app`, avoid duplicate clubs, and use existing Free registration, plan information and app links. It never initiates Stripe checkout or claims that PR #1456 is deployed.

## What is confirmed

- DFINITY publicly advertises `https://mcp.internetcomputer.org/mcp` for other MCP-capable assistants.
- Its implementation uses Internet Identity OAuth with ChatGPT-compatible CIMD or DCR registration.
- OpenAI plugin packages can declare an existing remote Streamable HTTP MCP connection.

## What remains unverified or blocked

1. **DFINITY approval for independent branded redistribution / endpoint reuse.** Public MCP-client access does **not** establish permission to market or publish their infrastructure as an Ignite-branded service. DFINITY's UI and OAuth screens still identify their provider.
2. **Public directory domain verification.** OpenAI's portal requires a challenge token at `https://mcp.internetcomputer.org/.well-known/openai-apps-challenge` or an eligible parent origin. Only DFINITY can arrange that on their hostname. A client of the connector cannot claim the domain. The portal currently does not publish an `.app.json` reference to an already installed plugin as a substitute.
3. **Separate install and authorization tests.** The public ICP endpoint is real, but the **Ignite-branded plugin's** OAuth connection, tool scan, audience restrictions and onboarding prompts have not been tested or approved.
4. **Live canister changes.** PR #1456's onboarding and subscription OQL additions still require a controlled DEV rollout. Nothing in this experimental plugin makes undeployed code live.
5. **Store links.** Production branded short redirects must be verified after release.

**Do not submit or advertise this package as an available consumer plugin until all gates pass.** If DFINITY cannot support domain verification / white-label use, ask whether an approved provider-owned Ignite-specific endpoint or an OpenAI marketplace partnership is available. Only then consider self-hosting DFINITY's Apache-2.0-licensed `imcp2` as a fallback; that is not necessary for this reuse experiment.

## Relevant sources

- https://internetcomputer.org/icp-mcp/
- https://github.com/dfinity/imcp2
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/submission

See `DFINITY-approval-request.md` for the specific questions the project owner can send to DFINITY.
