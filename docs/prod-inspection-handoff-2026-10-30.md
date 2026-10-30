# Next step: production evidence, not deployment

This workspace still connects only to DEV `ecsdwrarzfexssxtrymj`. No PROD database, Netlify or Codemagic inspection credentials are present, and the available workspace connections provide GitHub and Maps only. Do not rebind this DEV project or copy production secrets into chat to work around that boundary.

## Prompt for the PROD-connected Lovable project

> Perform a strictly read-only release inspection for Ignite Club HQ PROD `yabcfiuntwqjwvschnji`. Verify the connected project identity first; stop if it does not match. Do not modify data, settings, permissions, migrations, migration history, credentials, storage, cron jobs, workflows or deployments. Do not dispatch workflows or send notifications.
>
> Obtain the approved evidence pack from main at `docs/auth-prod-read-only-evidence.sql`. Inspect applied migration versions, account-creation function definitions and auth.users triggers, app_settings policies/grants, only the public backend_routing_config email-club allowlist, the two retained clubs' IDs, and the specified invitation/profile schema. Use a read-only transaction with bounded timeouts. If any section is unavailable, report it as unverified rather than guessing or repairing it.
>
> Inspect the two existing cron jobs by name: `auto-rsvp-push-cron` and `chat-photo-gallery-reminders-hourly`. Return only schedule, active state and credential-source classifications. Never output raw commands, JWTs, Vault values, invocation headers or secret contents. Confirm whether the actual jobs use trusted service credentials or only anonymous credentials; a header's presence alone does not prove service authorization.
>
> Save a credential-free report with project identity, applied migration versions, relevant definitions and findings. Do not declare release ready: the main database workflow is deliberately held, migration reconciliation is not approved, and the repaired reminder handlers must not deploy until scheduler credentials are verified. No remediation or release execution is authorized by this prompt.

## Separate hosted and device evidence

- Netlify: production branch/context must be `prod`, database/public-key bindings must target PROD, and the exact-commit promotion evidence read must succeed. Inspect without printing keys or triggering a deploy.
- Codemagic: preserve existing app/store identity and signing groups; verify `prod` source, signing/store access and promotion evidence reads. Do not start or publish a build during inspection.
- GitHub: required release checks and the production environment's approvals need hosted verification. PROD push activation stays disabled.
- Phones: notification receipt and tap-through require separately approved signed release-candidate builds on Android and iOS; source tests are not device evidence.