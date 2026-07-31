# Edge Function caller authentication

All Lovable-managed Edge Functions deploy with `verify_jwt = false`, so **every**
function must authenticate its own caller in code, before any privileged work
(service-role client creation, payload reads, queries, mutations, email/push).

Shared helpers: `supabase/functions/_shared/callerAuth.ts`

| Helper | Boundary |
| --- | --- |
| `requireServiceRoleAuth(req, cors)` | internal only: cron, DB triggers, other functions (`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`) |
| `requireServiceRoleOrAppAdmin(req, cors)` | internal **or** signed-in user with the `app_admin` role |
| `authenticateUser(req, cors)` | signed-in end user (token verified via `auth.getUser`) |
| `isServiceRoleCaller(req)` | constant-time service-role token check |

Contract enforced by `src/edge-functions/edgeFunctionAuthenticationContract.test.ts`.

## Caller matrix (hardened 2026-07-31)

| Function | Real caller | Auth mode |
| --- | --- | --- |
| backfill-chat-vault-groups | manual/service-role operations | service-role |
| check-push-failure-rate | pg_cron | service-role |
| cleanup-old-notifications | pg_cron | service-role |
| cleanup-push-subscriptions | pg_cron + Push Analytics admin UI | service-role or app_admin |
| export-write-audit | pg_cron / manual | service-role |
| post-game-photo-prompts | pg_cron + App Settings admin UI | service-role or app_admin |
| process-message-notifications | DB triggers (`on_*_message_created`) | service-role |
| process-weekly-engagement-bonus | pg_cron | service-role |
| retry-missed-push-notifications | pg_cron | service-role |
| send-block-alert-email | DB trigger (`on_user_blocked`) | service-role |
| send-feedback-email | app FeedbackDialog | authenticated user (identity from token) |
| send-invite-reminders | pg_cron | service-role |
| send-welcome-dm | app CompleteProfilePage | authenticated user (self only) or service-role |
| sync-dispatch-credentials | promotion pipeline, self-heal cron, app-admin UI | service-role, app_admin, or a single-use DB-issued bootstrap token |

Intentionally public: `public-club-events`, `public-club-teams` (read-only).

## Vault key drift (root cause of the 2026-07-31 notification outage)

The Vault copy of `service_role_key` can go stale relative to the key the Edge
Function gateway accepts — every trigger dispatch then returns `403 Forbidden`
and no notifications are created.

Repair path (no human ever handles the secret):

1. `public.bootstrap_dispatch_credentials(base_url)` mints a single-use, 2-minute
   token in `public.dispatch_bootstrap_tokens` and POSTs it to
   `sync-dispatch-credentials`.
2. That function writes its **runtime** `SUPABASE_SERVICE_ROLE_KEY` and URL back
   into Vault via `public.set_internal_dispatch_credentials`.
3. `self-heal-dispatch-credentials` (cron, every 15 min) runs step 1 automatically
   whenever `public.notification_dispatch_log` shows recent 401/403 dispatches.
4. `promote-to-prod.yml` runs step 1 after every promotion.

## Dispatch observability

Every message trigger records its attempt in `public.notification_dispatch_log`
(app-admin readable). `reconcile-notification-dispatch-log` (cron, every minute)
joins attempts to `net._http_response`, stores the status code and error body,
marks responses missing after 10 minutes as lost, and raises a warning when
failures occurred in the last 5 minutes. Fan-out failures are no longer silent.


## Database-side callers

DB triggers and cron jobs now read the service-role key from Vault via
`public.internal_service_role_key()` and the base URL via
`public.internal_functions_base_url()`. If either is missing the trigger logs a
warning and **skips** the call — it never falls back to an unauthenticated
request.

Required Vault secrets (per environment): `service_role_key`, `functions_base_url`.

## Deployment order

1. Apply the migration that updates DB triggers and reschedules cron jobs to
   send the service-role bearer token.
2. Deploy the Edge Functions that enforce authentication.

Deploying functions first would cause cron/trigger calls to 401 until the
migration lands.

## CI enforcement (promote-to-prod)

`.github/workflows/promote-to-prod.yml` gates promotion:

1. **Ensure PROD push-delivery prerequisites** — seeds and then *hard-fails* if
   either `service_role_key` or `functions_base_url` is missing/malformed in the
   PROD Vault. Runs **before** `db push` and before any function deploy.
2. **Apply migrations to PROD** — trigger/cron updates land first.
3. **Deploy changed edge functions to PROD.**
4. **Verify PROD callers authenticate to edge functions** — fails the run if any
   `cron.job` command or `public` trigger function that hits `functions/v1/`
   does not go through `public.internal_service_role_key()`. This catches a cron
   job or trigger left on an anon key, which would 401 silently against the
   hardened functions.
