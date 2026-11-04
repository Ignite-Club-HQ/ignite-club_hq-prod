# Invitation defaults and welcome message — release status

## Prepared

Candidate: `invitation-welcome-prod-candidate.sql`, SHA-256
`c8a332495aaaa08fd9ea6ee0e26c52840d3585f47eadfe862e2e2c98b30abe47`.

- Adds the missing `club_invite_message_defaults` table with explicit grants and RLS: members read only their club's message; club admins alone save/update/delete it. No default rows or club settings are copied from DEV.
- Adds `send_welcome_dm(uuid,text)` using the existing global Ignite Support message contract, not a new club welcome-email feature. Only the signed-in recipient can request their message. It preserves existing conversations/messages, serializes concurrent profile completions and sends at most one welcome per existing system-authored conversation. Text falls back to the current app default and is capped at 4,000 characters.
- Missing sender/recipient profile returns NULL without creating an orphan conversation. It does not invent or create the fixed Ignite sender profile.
- Existing signup/invitation acceptance, parent-child provisioning, role grants and email delivery code remain unchanged. Existing profiles.country migration is not bundled.

## Verification performed

12 exact-candidate SQL tests passed on disposable socket-only PostgreSQL, without hosted credentials. They verify admin upsert/member readback, cross-club denial, member write denial, anonymous grants, recipient-only welcome authorization, recipient readback/outsider denial, concurrency, retry preservation, missing sender and text limits.

24 existing frontend tests passed, 1 ICP-mode case skipped, across invitation defaults UI, pending-invite acceptance, repository and invitation policy. These are mocked component/logic tests, not a hosted invitation end-to-end run.

Read-only DEV inspection confirms the invitation defaults table and welcome RPC already exist, as does the fixed sender profile. This says nothing about whether PROD has the sender. DEV direct_conversations has the expected unique participant-pair constraint; exact PROD constraint compatibility remains to be confirmed.

## Not deployed or tested live

Workspace tools connect only to DEV, with no PROD deployment credential, GitHub write/dispatch tool or authenticated PROD browser session. This candidate remains under release-review, not executable migrations, and the signup-only safe-apply approval is unchanged. Nothing was written to hosted DEV or PROD, no invitation email was sent, and no production account/member/message was created.

Before PROD release, confirm absent target table/function, existing participant unique constraint, direct-message columns/policies, defaults-manager policy dependencies and fixed sender readiness through authorized target evidence. Register reviewed SQL via the migration tool and the existing fingerprinted approved-only release inventory. SQL policy subqueries require the existing structural review; do not weaken the checker to force a merge.

## Real club invitation acceptance still required

Use an explicitly approved live club/admin and recipient account. Save/read the default invitation message, send a club/team invite, confirm actual email contents and link, sign in through that invitation, complete the profile, verify exact club/team/role membership and see the one-time Ignite welcome DM. Reopen/retry to confirm no duplicate welcome; verify a different club user cannot access the default or conversation.

This actual flow remains blocked on live access, reviewed deployment and sender readiness. If PROD lacks the fixed sender profile, creating it is a separate explicit business-row approval; do not silently seed it or report successful message delivery.