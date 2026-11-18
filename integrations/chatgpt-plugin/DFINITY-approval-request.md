# DFINITY request: branded Ignite plugin on the existing hosted ICP MCP

**Draft for owner review — not sent.** Contact: mcp@dfinity.org (published in ICP MCP support).

Subject: Ignite Club HQ ChatGPT plugin — reuse of DFINITY-hosted ICP MCP

Hello DFINITY ICP MCP team,

I run Ignite Club HQ, a community sports team-management app with existing canisters and Internet Identity login. We are preparing a branded Ignite Club HQ plugin for ChatGPT, built around the same hosted ICP MCP tools we already use successfully.

We would prefer **not** to duplicate your MCP infrastructure or require our users to install two plugins. Your public endpoint `https://mcp.internetcomputer.org/mcp` already supports OAuth and ChatGPT-compatible client registration.

Could you advise:

1. May an independently published **Ignite Club HQ** plugin declare your existing hosted MCP URL as its one remote server, with its own onboarding skill and Ignite branding while clearly attributing DFINITY as the connector operator?
2. OpenAI requires proof of control over the MCP host at `/.well-known/openai-apps-challenge`. Could DFINITY cooperate with the verification for our plugin, or is there a supported partner/tenant-specific endpoint or alternative publisher arrangement?
3. Would each install be able to authenticate independently with your existing Internet Identity OAuth flow using CIMD/DCR (rather than requiring the DFINITY plugin separately)?
4. Are there usage limits, required terms, branding/attribution conditions, maintenance commitments or security review steps that we should plan for?
5. Would you recommend exposing Ignite-only constrained tools through your connector's service discoverability manifest, or a separate provider-managed integration?

We would be happy to provide our app manifest, the plugin package and a DEV test scenario. We will not publish the integration or imply DFINITY's approval before confirming it with you.

Thanks,
Ignite Club HQ
