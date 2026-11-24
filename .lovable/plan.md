# Secure sign-in phone alerts: names, everyone, missing alert types

## 1. Names in alerts (test servers first)
- Chat alerts: title becomes "Sender · Chat name" (or just the sender for direct messages), same as email mode. The message server adds the sender's display name and the chat name to each alert it files.
- Event, duty, photo and club alerts: title includes the event or club name where email mode does.
- Child names stay out of sub alerts and lock screens, as the project rules already require.
- The alert service stores the title next to the text; older servers that don't send a title still work (generic title).

## 2. Missing alert types (created on the secure servers)
Add alerts for: event updated, event note, RSVP reminder, duty assigned, message mention, message reply, role assigned, reward redeemed, storage limit, system announcement, fee payment. Each uses the same audience and settings rules as email mode, and each goes through the existing permission checks before sending.

## 3. Alerts for everyone on the live app
- Set up an alert sender for the second live server group (same as the first group, with its own key).
- Turn on the "send to everyone" switch on both live groups through the existing live release workflow. Only alerts created after the switch-on are sent, so no old backlog goes out.
- Order: everything is tested on the test servers with a phone first, then released live, then the switch is turned on. Paul approves the final switch-on in the release workflow.

## Technical details
- notification_queue: Notification gains optional `title`; `record_chat_notify_batch` gets a new versioned method taking title, keeping the old one for upgrade order; reserve_native_push returns title.
- messaging_domain: read sender display name from identity_access (plaintext adult names) and group metadata name, bounded call, failure falls back to no name.
- New producers in events_domain/club_domain/messaging_domain/points canisters, relayed via the trusted club_domain/messaging_domain paths.
- Sender: use reservation title when present; AGENTS rules updated.
- PROD: g2 sender seed secret + grant via [PROD] sender workflow; rollout via configure_native_push_rollout through governor in the release workflow. Nothing is run against PROD from here.
