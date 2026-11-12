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
- The chat tab should display accessible message bubbles and a free-text composer.
- The current pilot only returns chat NAMES, not message bodies. A new authenticated read_team_messages tool must use the existing protected read_account_list_messages_page and enforce team-conversation membership.
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
