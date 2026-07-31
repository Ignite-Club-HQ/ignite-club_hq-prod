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

Intentionally public: `public-club-events`, `public-club-teams` (read-only).

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
