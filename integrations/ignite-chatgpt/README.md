# Ignite Club HQ — ChatGPT customer tools (DEV prototype)

Status: **source-only, not deployed or connected as a branded ChatGPT plugin**. This is an Ignite-owned read-only application tool boundary, not a generic DFINITY connector forwarding layer. The current DFINITY ICP connection remains the only *live* ChatGPT-to-ICP test path.

## Implemented source contract

The module `src/core.mjs` exports five read-only handlers:

| Tool | Caller-visible result | Required scope |
|---|---|---|
| `get_ignite_profile` | Own identity and display nickname | Authenticated caller only |
| `list_my_clubs` | Own club IDs/names | Caller-scoped membership backend |
| `list_my_teams` | Teams in one authorised club | Verified club access |
| `list_team_events` | Accessible event dates/titles for a club/team | Verified club + team access |
| `list_conversations` | Accessible chat titles and IDs (no message bodies) | Verified club + team access |

Every tool rejects unexpected input fields, including a supplied principal, role, group, target canister or environment. The backend is assumed to enforce its own canister permissions; returned rows are additionally constrained to requested club/team scope and projected to minimal fields. No write tools or new subscription/trial/payment operations.

## Authentication gate — intentionally not implemented here

No independent branded MCP transport, OAuth server, Internet Identity session broker or user delegation exchange has yet been deployed. A branded plugin **cannot automatically inherit the DFINITY connector's credentials**. The `resolveVerifiedSession(extra)` integration must come from a separately reviewed bridge that verifies (1) the plugin OAuth token issuer, signature, expiry, intended audience and scopes; (2) an explicit Internet Identity delegation from the member; (3) the exact DEV derivation origin `https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app` and principal; and (4) caller-owned ICP agent identity. The bridge must never accept `principal`, `oauthVerified`, `actorFactory` or canister selection from an MCP tool input or unverified HTTP headers. The `session` structure in `core.mjs` is **an internal trusted interface, not an authentication mechanism**.

Required backend adapter methods: `getProfile(session)`, `listMyClubs(session)`, `hasClubAccess(session,clubId)`, `hasTeamAccess(session,clubId,teamId)`, `listMyTeams(session,clubId)`, `listEvents(session,clubId,teamId)`, `listConversations(session,clubId,teamId)`. These must use **real caller-signed ICP actors** and the shard router/placement registry, not an app-admin/service identity. An unrelated club must always be denied and unknown routing must fail closed.

Read the existing Candid before implementing: `club_domain.read_my_club_memberships_indexed`, `club_domain.read_account_execute`, `events_domain.read_account_list_events`, `messaging_domain.read_account_list_groups_by_club` and `read_account_list_groups_by_team`. The latter return Candid variants; unwrap only `#Ok`, and treat `#Err` and transport failures as refusal, not an empty list. If role membership in the club includes parents linked to a child, verify the correct team membership through current club authority—not a displayed role string alone.

## Next engineering gates

1. Implement and review an MCP HTTP transport plus OAuth 2.1 integration compatible with ChatGPT; pin the real origin/audience and consent scopes. Never expose an anonymous fallback for member endpoints.
2. Wire actual caller-delegated ICP actor adapters and explicit Group 1 / Group 2 club routing. Verify the DEV Internet Identity principal matches the Ignite app, with an **ordinary parent** and unrelated outsider.
3. Exercise all five tools end-to-end against DEV, including permission revocation and failures. Confirm no team or private chat metadata crosses club boundaries.
4. Add explicit write tools individually, with user confirmation, idempotency and verified readback. Start with own RSVP, then chat send, then club/team onboarding.
5. Preserve the existing production website `https://igniteclubhq.com/register` Free registration, `https://igniteclubhq.com/pricing` plan catalogue, II sign-in and Stripe handling. Do not recreate subscription writes or digital checkout flows.

### Test locally

```sh
node --test integrations/ignite-chatgpt/src/core.test.mjs
```

This tests the tool contract and security gating with synthetic adapters. It does **not** prove real login, canister calls, plugin registration or store publication.
