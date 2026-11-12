# Ignite interactive ChatGPT UI — development plan (DEV only)

Status: DESIGN + INTERACTIVE STATIC PROTOTYPE. Not a live MCP Apps UI. Current private Ignite pilot is an instructions-only plugin bound to DFINITY ICP MCP and cannot register its own UI resource.

## Customer experience
- My team header shows the club and team, not canister IDs.
- Three large buttons: Schedule, Team chat, Quick RSVP.
- When multiple teams exist, select a team from caller-authorized choices. Never automatically treat an app-admin's clubs as personal teams.
- Cards show local times, locations, and actionable labels. Empty schedule is distinguished from failed loading. Mobile layouts require accessible labels and ≥40px tap targets.

## RSVP interaction
- Show each event and which RSVP subject is answering: the caller or an eligible linked child. One parent may answer for more than one child.
- Offer Going / Maybe / Can't attend; initially stage a preview, not a saved result.
- New tool set_my_rsvp should receive event_id, authorized subject selection and chosen state. Resolve the actual account_id, subject authority, event club/team and canister route server-side.
- Existing events-domain methods are set_rsvp(event_id, account_id, state, notes) and set_child_rsvp(event_id, account_id, child_id, state, notes). The server must enforce authorization again; tool inputs must never assert the account ID.
- Fetch existing RSVP, validate event/subject/expiry, then require explicit confirmation and read back the authoritative state. Handle duplicate taps and timeouts without fake "Saved" messages.

## Team chat interaction
- The chat tab should display accessible message bubbles, a conversation selector, local timestamps, a search field, a **Load earlier messages** button, and a free-text composer. The source-only HTML prototype demonstrates all these interactions using labelled fictional messages.
- The current private DFINITY-dependent pilot **v0.1.7** can read an explicitly opened, caller-authorized chat's real message history through protected `read_account_list_latest_messages_page`. It returns an ordinary ChatGPT response, not an embedded app widget. The standalone Ignite-owned MCP integration still needs an authenticated adapter and live UI resource to display that history inline.
- Draft text remains local until the user explicitly confirms destination and content.
- New send_team_message tool should call the signed caller's messaging-domain send_message(conversation_id, body, idempotency_key, attachment, reply_to_id) method using a server-generated idempotency key, enforce posting permissions and prevent cross-club traffic.
- Only say "Sent" after authoritative success and readback. Use client-side disabled/loading states to prevent double submission.

## Required architecture
- An Ignite-owned MCP server with verified OAuth and caller-delegated Internet Identity (the skills-only DFINITY dependency wrapper cannot serve an MCP Apps UI).
- Verify issuer/audience/expiry/scope and exact DEV derivation origin, ensure signed ICP actors and server-side group routing. Never accept caller-supplied principal or backend canister IDs.
- Separate data tools from one UI render tool to avoid re-rendering the chat composer after every tool invocation.
- Preserve a text-only fallback in ChatGPT/Codex. Never write to PROD.
- For child sports data, apply current app permissions and privacy handling on the backend, not just in the widget.

## Trial checklist
- [ ] UX preview works on Android and web, including keyboard focus and dark mode.
- [ ] Real parent account with multiple children / clubs sees only eligible RSVP subjects.
- [ ] Coach is subject to actual posting permissions; app-admin visibility does not automatically grant parental RSVP rights.
- [ ] Revoked and unrelated accounts cannot read private chats or write.
- [ ] Double-tap and timeout cannot duplicate a message or claim a false RSVP success.
- [ ] Authoritative readback matches native Ignite after confirmed write.
- [ ] Installed ChatGPT plugin actually renders the MCP Apps UI.

## Prototype
UI: ui/my-ignite-prototype.html

Sample events/messages are fictional and explicitly marked as such. Schedule/chat tabs and quick-action buttons operate locally, and the message editor supports drafting/review. No RSVP is saved and Send is intentionally disabled. This is a source-only user-experience demonstration until a dedicated authenticated Ignite MCP server is implemented and registered.

Documentation:
- https://developers.openai.com/plugins/build/app-quickstart
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/concepts/ui-guidelines


## Explore Ignite: verified navigation targets (13 November 2026)

The UI prototype includes these links; internal links deliberately target the pinned DEV website and mobile store links target published apps:

| Label | Destination | Notes |
| --- | --- | --- |
| Gallery | https://ignite-club-launchpad.lovable.app/media | Verified React route /media |
| Club news | https://ignite-club-launchpad.lovable.app/news | Verified React route /news |
| File vault | https://ignite-club-launchpad.lovable.app/vault | Verified React route /vault; subscription and club permissions can restrict access |
| All events | https://ignite-club-launchpad.lovable.app/events | Verified React route /events |
| Team page | https://ignite-club-launchpad.lovable.app/teams/5ece6fc0-f2a8-4295-86e7-e71775d243f8 | DEV demonstration team only; replace with selected authorized team at runtime |
| Rewards | https://ignite-club-launchpad.lovable.app/clubs/f9f7d89c-a51f-454d-af8e-b976c10d2fc4/rewards | DEV demo club only; replace with selected authorized club and check entitlement |
| iPhone app | https://apps.apple.com/au/app/ignite-club-hq/id6758928691 | Verified official Apple App Store listing |
| Android app | https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub | Verified official Google Play listing |

**Runtime guardrails:** All club- and team-scoped links must be constructed from the selected caller-authorized club or team in the future MCP UI, not from arbitrary model arguments. There are no direct contents or access claims for Gallery, News, Vault or Rewards: a route can exist while a user lacks permissions or plan entitlements. These links may open a separate browser/session or prompt to sign in. Do not imply ChatGPT Internet Identity credentials automatically transfer to the mobile apps. No claims of automatic installation or app-store purchases.

**Production deployment:** The published mobile app links intentionally differ from DEV destinations. Distinguish "Open in Ignite DEV" from "Get the mobile app". These are verified locations, not a promise that the host will directly deep-link into installed native apps. Club-specific routes on iOS/Android need separately tested universal/app link support.

**MCP App goal:** Present this as a compact Explore section below the main team actions, with two obvious store links. Add role/plan-aware hiding or a locked state once the authenticated MCP App is wired; the static preview merely links to route entry points.


## Verified history pagination behavior

DEV messaging API `read_account_list_latest_messages_page(conversation_id, before: opt nat64, limit:nat16)` returns `Ok {messages, latest_sequence, next_sequence}`. First request uses `before = null`; the next older page uses `before = opt (N : nat64)` with the exact returned `next_sequence`. Limit to 20 per call and merge by message ID in sequence order. A `next_sequence = null` result is the start of history, not necessarily an empty conversation. Never treat `read_account_list_messages_page` as scrollback: that method pages in the opposite direction. Verified on 13 Nov 2026 against the authenticated Riverdogs U8 Rockets conversation: 3 messages returned, and a size-1 page successfully fetched a preceding message using the returned sequence cursor. The non-admin test account could read its own Giddy Goat team chat (8 messages), while its Group 2 test team returned a valid empty message vector. No writes.

In the standalone MCP Apps view, `Load earlier` must call the caller-scoped `list_conversation_messages` tool using the server-authenticated account. Preserve current scroll position, show edits and reply context when available, and never expose a Principal ID as the displayed sender. Group/team-specific route and membership checks are repeated on every page. Current HTML preview uses fictional pages: do not describe it as live.


## Rich message rendering parity

Real DEV Riverdogs chat history included a message whose body is a poll reference `[poll:<id>]`, rather than human-facing text. Verified the authenticated read-only `read_account_get_poll_results(poll_id)` returns `Ok PollResults` with the poll question, options, counts, total votes, closed flag, and `conversation_id` (for same-room verification). The recorded test poll had the question "Test" and two options. A chat UI must interpret and resolve this reference as a **poll card**; never display the raw `[poll:…]` string as the customer's entire message.

For the customer-facing MCP App: (1) load the newest 20 messages; (2) inspect message body and attachment kind for rich link tokens; (3) fetch matching card metadata only for the caller's authorized room, with a bounded fan-out; (4) render accessible poll cards and verified gallery/news/vault link previews or a privacy-preserving "Shared item" placeholder; (5) show edit indicators, replies and reactions when separately permitted; (6) load older pages with the Candid backward cursor; (7) search only that authorized conversation; (8) never claim that reaction, poll vote, chat send, or RSVP controls write to Ignite until dedicated authenticated methods pass review and readback. Loading a poll card must not submit a vote. Plain text and card previews should be escaped/sanitized and use the same membership checks as the rest of the thread.
