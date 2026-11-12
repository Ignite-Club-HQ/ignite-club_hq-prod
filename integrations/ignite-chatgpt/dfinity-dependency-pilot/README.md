# Ignite-branded ChatGPT plugin — DFINITY dependency pilot

**Status: private source prototype; NOT installed in ChatGPT by this PR. No production deployment or writes.**

This tests **approach 2**: bundle Ignite-specific instructions and a branded plugin manifest while reusing the existing DFINITY-hosted ICP MCP (`https://mcp.internetcomputer.org/mcp`). The remote MCP server owns authentication and canister calls. The package supplies no standalone OAuth/MCP server, secrets, or app-admin access. The DEV source canisters are not redeployed.

## Contents

- `plugin.json`: portable Agent Plugins manifest and OpenAI presentation metadata; intentionally no fabricated logo file or unrelated app IDs.
- `mcp.json`: DFINITY remote streamable HTTP endpoint with OAuth. Authentication must be discovered and completed by the host; this JSON is NOT evidence that OAuth works in the Ignite-branded installation.
- `agents/openai.yaml`: the Ignite skill's MCP dependency metadata.
- `skills/ignite-dev-connect/SKILL.md`: caller-scoped, **read-only** Ignite DEV workflow and negative permission tests.
- `../../scripts/test-dfinity-plugin-package.mjs`: package contract tests.

## Real connection evidence (existing DFINITY plugin, 12 Nov 2026)

Using an already connected Internet Identity **Test** account in ChatGPT, DFINITY ICP MCP successfully discovered all four DEV events/messaging canisters (G1 and G2), returned the expected DEV derivation origin, resolved the selected principal, returned a club chat, and returned authorised team events. This demonstrates that the **underlying service works**, not that a second branded plugin reuses the same OAuth grant.

## Next private installation experiment

1. Validate the package with `node --test integrations/ignite-chatgpt/scripts/test-dfinity-plugin-package.mjs`.
2. From ChatGPT Work's plugin creator or Codex desktop, point at this folder and generate a **local marketplace entry**. The environment must explicitly support local/repo marketplace installation; merely committing a plugin folder does not install it.
3. If using the portable remote `mcp.json`, configure the connection through the normal OAuth discovery and consent flow. Confirm whether the same Internet Identity is offered and whether a second approval is required. No credential copying or OAuth token reuse by hand.
4. Install the plugin privately and run the positive/negative prompts from its SKILL.md with a non-admin parent account. Verify the account's effective principal and exact DEV derivation origin after the branded installation.
5. Do not publish publicly before reviewing OpenAI's current plugin submission policy, DFINITY's operator terms, the scope of its hosted endpoint, and the user's authorisation.

**Important platform limit:** OpenAI currently says ZIP plugins referencing existing registered integrations via `.app.json` cannot be submitted publicly. For private testing this package uses a **direct remote MCP URL**, which also requires its own installation and authentication acceptance. Do not present the original ICP plugin's existing OAuth token as automatically available.

**No implementation promise:** the generic DFINITY connector may expose write-capable tools even though this skill asks for reads only. For strong user-level tool allowlisting, we must have a server-side permission solution. The package is intentionally restricted to a private pilot, not an open self-service product.

## DFINITY questions saved

Deferred, not sent: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/issues/1491

## References

- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/build/skills
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/deploy/submission
- https://internetcomputer.org/icp-mcp/
