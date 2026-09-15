# Edge Function and scheduled-work ownership

**Status:** Authoritative repository inventory, reviewed 2026-08-18.
**Operational owner:** Must be replaced with the named vendor/team during
handover. Until then, repository maintainers own review and production approval.

There are 118 deployable `supabase/functions/*/index.ts` entry points. This file
maps operational ownership by domain; source, migrations and hosted schedules
remain authoritative. “Scheduled-capable” means the source references cron or
scheduling—it does not prove that a hosted schedule is currently enabled.

## Non-negotiable controls

- Functions with `verify_jwt = false` must authenticate explicitly in source or
  validate a provider/cron secret. Gateway configuration is not authorization.
- Never infer deployed state, secrets or schedules from Git alone. Verify them
  in the target Supabase/project/provider consoles during handover.
- Backend deployment precedes frontend code that depends on it.
- Changes to payments, authentication, destructive operations, notification
  fan-out or public endpoints require a named security reviewer.

## Domain ownership

| Domain | Primary entry points | Required review |
| --- | --- | --- |
| Account, auth and passkeys | `admin-delete-account`, `admin-set-temp-password`, `admin-update-email`, `auth-email-hook`, `delete-account`, `export-user-data`, `passkey-authenticate`, `passkey-register`, `recover-account`, `secret-delete-user` | Identity/security |
| Events, RSVP and duties | `association-create-club-event`, `auto-default-rsvp-confirm-cron`, `auto-default-rsvp-maintenance-cron`, `auto-post-event-to-chat`, `auto-rsvp-dm-cron`, `auto-rsvp-push-cron`, `confirm-event-payment`, `create-event-checkout`, `notify-event-note`, `notify-game-kickoff`, `notify-new-member-events`, `post-game-photo-prompts`, `process-duty-points`, `process-event-notifications`, `public-club-events`, `public-club-teams`, `send-duty-notification-email`, `send-event-reminders`, `send-event-view-reminder` | Events + notification security |
| Messaging and summaries | `assemble-catchup`, `backfill-chat-vault-groups`, `digest-messages`, `fetch-link-preview`, `giphy-search`, `process-message-notifications`, `process-scheduled-messages`, `scheduled-messages-write`, `send-message-notification-email`, `send-message-report-email`, `send-welcome-dm`, `summarize-chat`, `summarize-chat-icp` | Messaging/realtime |
| Notifications and engagement | `check-pending-subs`, `check-push-failure-rate`, `check-vapid-key`, `cleanup-old-notifications`, `cleanup-push-subscriptions`, `notify-join-request-decision`, `process-push-delivery-queue`, `process-weekly-engagement-bonus`, `process-weekly-engagement-digest`, `retry-missed-push-notifications`, `send-engagement-reminders`, `send-fcm-notification`, `send-invite-reminders`, `send-photo-prompt-followup`, `send-push-notification`, `send-update-reminder`, `test-push-notification` | Notification security + operations |
| Email and reports | `send-block-alert-email`, `send-comment-report-email`, `send-email`, `send-enrolment-notification-email`, `send-eoi-invite`, `send-feedback-email`, `send-game-stats-email`, `send-new-club-alert`, `send-photo-notification-email`, `send-photo-report-email`, `send-pitch-board-notification-email`, `send-points-notification-email`, `send-renewal-reminders`, `send-reward-redeemed-email` | Communications/privacy |
| Payments and entitlement | `cancel-subscription`, `check-iap-authorization`, `create-member-payment-checkout`, `create-storage-checkout`, `create-subscription-checkout`, `expire-subscriptions`, `manage-stripe-config`, `reconcile-legacy-subscriptions`, `stripe-webhook`, `verify-iap-receipt` | Payments/security |
| Vault, Storage and Drive | `auto-purge-trash`, `drive-folder-sync`, `get-signed-photo-url`, `google-drive-import`, `permanent-delete-entity`, `permanent-delete-photos`, `resolve-drive-titles`, `send-storage-warnings`, `vault-backup`, `vault-backup-list`, `vault-backup-restore`, `wipe-club-vault` | Storage/security |
| Competition, PlayHQ and pitch | `pitch-timer-event`, `pitch-timer-read`, `playhq-materialise-team-events`, `playhq-sync`, `playhq-sync-club`, `playhq-sync-cron`, `send-competition-broadcast` | Competition + live game |
| Association, EOI and club operations | `eoi-webhook`, `generate-demo-data`, `google-places-search`, `send-association-broadcast`, `send-club-announcement` | Club/association |
| Audit, diagnostics and platform | `audit-orphan-children`, `cleanup-deleted-accounts`, `export-write-audit`, `icp-llm-test`, `prefetch-user-data`, `public-minimum-app-version`, `realtime-stats`, `scheduled-backup`, `share-page`, `sync-dispatch-credentials` | Platform/security |

## Scheduled-capable inventory

Source inspection identifies these high-priority scheduled or worker paths:

- RSVP/defaulting: `auto-default-rsvp-confirm-cron`,
  `auto-default-rsvp-maintenance-cron`, `auto-rsvp-dm-cron`,
  `auto-rsvp-push-cron`.
- Notification workers: `process-event-notifications`,
  `process-message-notifications`, `process-push-delivery-queue`,
  `retry-missed-push-notifications`, `check-push-failure-rate`.
- Engagement: `process-weekly-engagement-bonus`,
  `process-weekly-engagement-digest`, `send-engagement-reminders`,
  `digest-messages`, `chat-photo-gallery-reminders`.
- Maintenance: `auto-purge-trash`, `cleanup-deleted-accounts`,
  `cleanup-old-notifications`, `cleanup-push-subscriptions`,
  `expire-subscriptions`, `scheduled-backup`.
- Integrations: `playhq-sync-cron`, `drive-folder-sync`,
  `sync-dispatch-credentials`.

## Secret inventory labels

Source references these secret/configuration labels. Values must never be copied
into documentation or local tests:

`AUTO_RSVP_DM_CRON_SECRET`, `CRON_SECRET`, `FCM_CLIENT_EMAIL`,
`FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`, `GEMINI_API_KEY`,
`GIPHY_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_PLACES_API_KEY`, `LOVABLE_API_KEY`, `NEW_CLUB_ALERT_SECRET`,
`RESEND_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY`,
`VAPID_PUBLIC_KEY`, and `VAPID_SUBJECT`, plus standard Supabase runtime values.

## Handover verification record

For every production-enabled function or schedule, the incoming vendor must
record: named owner, deployment workflow, invocation source, authentication
method, required secret labels, tables/RPCs touched, retry/idempotency policy,
monitoring/alert location, last successful execution, and rollback procedure.
Unknown hosted state remains an explicit handover blocker—not an assumption.
