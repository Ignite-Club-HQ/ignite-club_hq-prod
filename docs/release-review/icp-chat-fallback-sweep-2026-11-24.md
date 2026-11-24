# Internet Identity chat fallback sweep — DEV only

## Rule

When signed in with Internet Identity, chats and their supporting information must stay on ICP, including after sign-in restoration, resume, queued reads and retries. They must not use the email account's Supabase records when ICP is unavailable.

This is a source-read and isolated-regression review of the chat-group paths enumerated below, not a certification of every screen or dependency in the application. No PROD deployment, configuration, permission or stored-record change was performed.

## User-facing inventory

All paths below were read in this sweep. **Repaired** means the reviewed branch now obeys the boundary; **Already routed** means its selection was already made at execution. Neither label asserts phone acceptance.

| Screen or flow | Source | Result |
| --- | --- | --- |
| Home and mobile/desktop Messages badges | `hooks/useNavMessagesBadgeCount.ts`, `components/layout/BottomNav.tsx`, `components/layout/DesktopNavRail.tsx` | Previous repair retained; queued badge reads select current messaging backend, with scoped ICP group/club lookups. |
| Desktop recent chats and club filtering | `components/layout/DesktopMessagesRail.tsx` | Repaired five queued legacy reads; club-scope query no longer enabled for ICP. |
| Header and notification bell | `components/layout/AppHeader.tsx` | Queued legacy vault-role lookup repaired; reviewed ICP notification click path returns before legacy chat probes. |
| Messages inbox, support/broadcast, mute and hidden preferences | `pages/MessagesPage.tsx`, `features/messaging/inbox/inboxRepositories.ts`, `inboxPreviewSources.ts` | Repaired render-captured broadcast selection, 27 email-only repository entry points, weaker restored-session detection and queued legacy DM source. |
| Hide a DM or custom group | `pages/MessagesPage.tsx`, `components/chat/ConversationRow.tsx` | Unsupported ICP hide controls omitted; mutations also refuse before Supabase writes. Existing hidden records unchanged. ICP hiding has not been implemented. |
| Open/read/post group chat | `pages/GroupChatPage.tsx`, `features/messaging/thread/useGroupDeleteChat.ts` | Already dispatched at execution; ICP errors do not enter the email provider. Competition-posting-settings branch is conditional on a field absent from the reviewed ICP metadata projection; not claimed as a reachable fallback or changed. |
| Participants/details, supporting role, bot, preferences and online reads | `components/chat/ChatParticipantsList.tsx` | Repaired captured membership selection and execution guards for supporting email-only reads; existing ICP roster path retained. Leave/remove handlers now check current mode too. |
| Read receipts and group-reader roster | `components/chat/ReadReceiptSheet.tsx` | Strengthened mounted-session detection and retirement of email work after awaits; ICP receipt/group readers retained. |
| Mention people | `components/chat/MentionInput.tsx` | Already selects current backend; repaired dispatch scope for DM, group and team mentions. |
| Start a direct message and pick people | `components/chat/StartDMDialog.tsx` | Repaired queued Pro/eligibility/candidate reads and captured-mode DM action. Existing canister authorization remains responsible for acceptance. |
| Create an explicitly selected custom group | `components/chat/StartDMDialog.tsx` | Added ICP provider using existing group contract: selected participants plus creator, creator as owner, invite-only category policy. Category failure after acknowledged creation returns the group instead of inviting duplicate creation. |
| Create role-scoped group | `components/chat/CreateGroupDialog.tsx` | Reviewed pick/count/create branches check mode at execution; strengthened shared `isIcpSession` helper covers mounted restoration. |
| List club/team groups | `components/chat/ChatGroupsList.tsx` | Already dispatched; repaired team-only read scope. |
| Discover/join/request access to groups | `components/chat/DiscoverGroupsList.tsx` | Reviewed directory/admin reads and join/request handlers select ICP at execution. |
| Edit group | `components/chat/EditGroupDialog.tsx` | Metadata, permissions and save providers already dispatched; no permission changes. |
| Create poll from group/team chat | `components/chat/CreatePollDialog.tsx` | Added ICP ownership lookup for the supporting club read; poll creation already dispatched. Existing canister poll limitations remain. |
| Forward a message | `hooks/useForwardMessage.ts` | Existing destinations/send dispatch retained; mixed-backend batch now stops before crossing providers. Successful forwards are not replayed or changed. |
| Club page delete/restore chat cascades | `pages/ClubDetailPage.tsx` | Already checks current backend inside handlers and returns before legacy cascade. Exact deletion/restore markers unchanged. |
| Club setup operational groups | `pages/ClubSetupWizardPage.tsx` | Already checks current messaging mode when invoked. |
| Club setup completion card | `components/club/ClubSetupProgressCard.tsx` | Reviewed ICP branch dispatches and rejects an intervening backend change; no legacy fallthrough. |
| Mini-league chat lookup | `pages/MiniLeagueDetailPage.tsx` | Already checks current messaging mode inside query. |
| Competition chat directory/admin inbox | `components/competitions/CompetitionChatsCard.tsx`, `CompetitionAdminInboxCard.tsx` | Reviewed reads already select/dispatch at execution. |
| Scheduled-message destination labels | `pages/ScheduledMessagesPage.tsx` | Already dispatched at execution; legacy label helper stays email-only. |
| Notification page/chat reaction links | `pages/NotificationsPage.tsx` | Reviewed ICP click branch returns before legacy container probes. |
| Removed-chat admin list/restore/purge | `pages/AdminDeletedChatsPage.tsx` | Already dispatched; no stored deletion/restore/purge operation performed. |
| Backup tree chat label | `pages/ManageBackupsPage.tsx` | `chat_groups` occurrence is a display classification, not a database read. This does not certify every backup callback. |
| Event cancellation/chat notice | `components/events/EventCard.tsx`, `hooks/useCancelEventMutation.ts` | Reviewed cancellation branches dispatch and return before email chat writes. |
| Chat recap club/user availability | `hooks/useAICatchUpAvailability.ts` | Both preferences already dispatched; no failed ICP-to-Supabase catch. Default/error presentation not re-certified. |

## Shared and background inventory

| Boundary | Result |
| --- | --- |
| `lib/icpClubTeamLookup.ts` | Uses the same mounted/stored/explicit ICP signals as strict transport, rather than the country resolver alone. |
| `lib/clubScopeLookup.ts`, `lib/routeClubScope.ts` | Route classification is transport-free; chat ownership now uses scoped ICP content read. Unknown ownership still leaves the filter unchanged. |
| `lib/notificationClubSwitch.ts` | Team/group/club-admin/payload-team notification resolution now reuses ICP-aware lookup, including deferred restoration retries. |
| `lib/filterClubScopedNotifications.ts` | Mounted ICP callers use the queue's explicit club scope/global types. Unresolved club-scoped rows are excluded without querying email messages; no notifications deleted. |
| `lib/prefetchData.ts` | Retires queued email prefetch after session/edge waits, before direct fallback and message launch, and at metadata/media helper entry points. |
| `features/messaging/inbox/inboxRepositories.ts` | All 27 exported email transport reads reject secure sessions before client access. No query filters/permissions changed. |
| `features/messaging/inbox/inboxPreviewSources.ts` | Three routed preview sources use mounted-session boundary; email-only direct source refuses ICP before its initial read/compatibility retry. |
| `features/notifications/notificationNavigationRepository.ts` | Four legacy transport entry points refuse mounted ICP sessions before client calls; email exact-message/time-window behavior retained. |
| `live/featureRouter.ts`, `live/strictIcpTransport.ts` | Reviewed existing fail-closed dispatch and final network guard retained; no warning suppression or widened external exception. |
| `live/features/messaging.ts` | Reviewed query/update/older-method retries retain ICP actor; send retries retain context/idempotency key. Dedicated empty-payload push kick is not chat persistence fallback. |
| `backend/messaging_domain/src/main.mo` | Reviewed scheduled delivery, forwarding and replay reuse `sendAs`; scheduled delivery requires the trusted queue. Existing group member/role/join-policy contract read for the custom-group adapter. No backend changes. |

## Server/database boundary — source read only

Read the relevant branches in:

- `supabase/functions/notify-join-request-decision/index.ts`
- `supabase/functions/send-push-notification/index.ts`
- `supabase/functions/send-message-report-email/index.ts`
- `supabase/functions/send-message-notification-email/index.ts`
- `supabase/functions/process-message-notifications/index.ts`
- `supabase/functions/retry-missed-push-notifications/index.ts`
- `supabase/functions/verify-iap-receipt-icp/index.ts`
- `supabase/functions/icp-dev-push-sender/index.ts`

These inspected notification/report/push paths are not ICP chat-persistence failure fallbacks. They were not invoked or deployed. The referenced `prefetch-user-data` server implementation and a Supabase scheduled-chat-delivery implementation were absent from the searched tree, so their hosted behavior is unverified.

Read the matching migration blocks for the two revisions of `public.can_access_chat_group`, three competition pinned-Vault insert/update/delete policies, the competition-admin inbox setup and `accept_competition_role_link` chat lookup. These operate on email-mode tables, not ICP fallback persistence. No migrations, policies, cron jobs or live database functions were changed or executed. This is not a general authorization or all-history database audit.

## Verification and limits

- Original Home regression reproduced three delayed-query failures before repair.
- Final focused run: **19 files, 291 tests passed in email mode; 19 files, 291 passed in ICP mode**. Ten mode-specific forwarding tests skip in each mode and execute in their matching mode. Total: 582 passes, no failures.
- Added execution tests for 31 repository boundaries, participants/supporting reads, delayed people/DM/poll actions, explicit group membership, acknowledged-category failure, five desktop readers and background notification/prefetch restoration.
- Existing scoped routing, strict network isolation, inbox directory refresh, exact notification navigation, email repository behavior, forwarding, page decomposition, bottom navigation and scheduled-label tests passed.
- Email-only repository fixtures are explicitly pinned to email; separate tests exercise actual mounted ICP state without stored delegation.
- Preview's latest observed build entry: **build OK**. No manual production deployment/build was run.
- No signed-in end-to-end browser, restored real-user chat, physical phone or live-source parity acceptance: the sandbox has external unmanaged Internet Identity and no delegated account/device. These remain required before release; public/signed-out testing is not a substitute.
- PROD, settled/sent/closed records, subscriptions, settings, permissions and example data are unchanged. New code is DEV-only.