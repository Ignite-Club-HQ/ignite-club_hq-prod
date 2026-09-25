# Contact Competition Admins

## What users get
- On a competition's page (and in Messages > New message), a **"Contact competition admins"** card, next to the existing "Contact club" card.
- Tapping it opens one private conversation between that person and the competition's admin team. Each person has one ongoing thread per competition.
- Who can see the button: anyone with a team entered in the competition (players, parents, coaches, team admins) and competition referees/committee members. Competition admins don't see it for their own competition.

## Who receives (strict)
- **Only people with the Owner or Admin role on that competition.**
- Club admins, league admins and committee members of the host club do **not** receive or see these threads, even for the club running the competition, unless they are also a competition Owner/Admin.
- If someone is added as a competition admin later, they see existing threads. If removed, they lose access immediately.
- App admins keep their usual support access (tell me if you want this removed too).

## Admin experience
- A **"Competition inbox"** section in Messages, shown only to competition admins, listing threads with unread badges. It sits separately from the club admin inbox.
- Replies show as "Competition admins" (with the competition name), so the sender knows it's the organisers replying and not a club.
- Push notification and in-app bell for every competition admin when a new message arrives. These alerts carry the competition's name, not a club's.

## Kept separate from club contact
- Separate conversations and messages, so they never appear in the club admin inbox.
- Club filtering: threads appear under the organising club or any club with an entered team, matching how competition chats already behave. They never appear under an unrelated club.

## Technical details
- New tables `competition_admin_conversations` (competition_id, user_id, last_message_at, unique pair) and `competition_admin_messages` (conversation_id, sender_id, content, attachments, is_admin_reply), with GRANTs + RLS.
- Access helper `is_competition_admin(_user, _competition)` (SECURITY DEFINER), true only for `competition_roles.role IN ('owner','admin')`. RLS: the requester reads/writes their own thread; competition admins read/write threads for their competition. No `user_roles`/club_admin clause anywhere.
- RPC `get_or_create_competition_admin_conversation(p_competition_id)` checks eligibility (entered team role or referee/committee) and returns the thread id.
- Trigger on message insert notifies only competition admins (not the sender), stamped with `organizer_club_id` for bell scoping.
- Frontend: `ContactCompetitionAdminsButton`, route `/messages/competition-admin/:id` reusing the club-admin chat view, `CompetitionAdminInboxList` in MessagesPage/DesktopMessagesRail.
- Build in DEV first, including a test that a club admin who isn't a competition admin gets zero rows. Production only with your approval.
