# Edge Function Secrets Inventory

**Purpose:** Disaster-recovery reference for every custom secret used by this app's Supabase Edge Functions.

**⚠️ Do NOT store secret VALUES in this file.** Values live only in:
1. The Supabase dashboard → Edge Function Secrets (runtime)
2. Your team password manager / secure vault (backup copy)

Update this file whenever you add, remove, or repurpose a secret.

---

## Where to store the actual values

Pick one and stick to it:

- **Bitwarden (free):** create a Collection "Ignite Club — Edge Secrets", one item per row below.
- **1Password:** create a Vault "Ignite Club — Edge Secrets", one item per row.
- **Encrypted file:** a single `.gpg` or password-protected doc kept off the repo.

For each secret, save: **name**, **environment** (dev/prod), **value**, **where to regenerate it**, **last rotated date**.

---

## Secrets

### Payments & billing

| Secret | Used by | Source | Notes |
|---|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Stripe dashboard → Developers → Webhooks → endpoint signing secret | Re-issued if endpoint URL changes (e.g. new project after DR) |

> Stripe API keys are stored per-club in the DB (`stripe_configs`), not as edge secrets.

### Email delivery

| Secret | Used by | Source |
|---|---|---|
| `RESEND_API_KEY` | `auth-email-hook`, `send-email`, `send-block-alert-email`, `send-comment-report-email`, `send-enrolment-notification-email`, `send-event-view-reminder`, `send-feedback-email`, `send-message-report-email`, `send-photo-report-email` | Resend dashboard → API Keys |

### Push notifications

| Secret | Used by | Source |
|---|---|---|
| `FCM_SERVICE_ACCOUNT` | `send-fcm-notification`, `send-push-notification` | Firebase console → Project settings → Service accounts → Generate new private key (paste full JSON) |
| `FCM_CLIENT_EMAIL` | same | From FCM service account JSON (`client_email`) |
| `FCM_PRIVATE_KEY` | same | From FCM service account JSON (`private_key`) |
| `FCM_PROJECT_ID` | same | From FCM service account JSON (`project_id`) |
| `VAPID_PUBLIC_KEY` | `check-vapid-key`, `send-push-notification` | Generated via `npx web-push generate-vapid-keys` — must match client build |
| `VAPID_PRIVATE_KEY` | same | Same generation step |
| `VAPID_SUBJECT` | same | `mailto:admin@yourdomain` — non-sensitive |

### AI

| Secret | Used by | Source |
|---|---|---|
| `GEMINI_API_KEY` | `digest-messages`, `summarize-chat` | Google AI Studio → API keys |
| `LOVABLE_API_KEY` | `auth-email-hook` | Lovable dashboard (auto-managed — rotate via Lovable tools, not manually) |

### Third-party integrations

| Secret | Used by | Source |
|---|---|---|
| `GIPHY_API_KEY` | `giphy-search` | Giphy developers dashboard |
| `GOOGLE_PLACES_API_KEY` | `google-places-search` | Google Cloud console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_ID` | `drive-folder-sync`, `google-drive-import`, `resolve-drive-titles` | Google Cloud console → OAuth 2.0 Client IDs |
| `GOOGLE_CLIENT_SECRET` | same | Same OAuth client |

### Cron / internal auth

| Secret | Used by | Source | Notes |
|---|---|---|---|
| `CRON_SECRET` | `admin-update-email`, `auto-purge-trash`, `cleanup-deleted-accounts`, `expire-subscriptions`, `notify-game-kickoff`, `process-duty-points`, `process-weekly-engagement-digest`, `reconcile-legacy-subscriptions`, `send-engagement-reminders`, `send-event-reminders`, `send-renewal-reminders`, `send-storage-warnings`, plus RSVP cron jobs | Random string you generate | Also configured in `pg_cron` job headers — must match |
| `AUTO_RSVP_DM_CRON_SECRET` | `auto-default-rsvp-confirm-cron`, `auto-rsvp-dm-cron`, `auto-rsvp-push-cron` | Random string you generate | Same as above |
| `ADMIN_DELETE_SECRET` | `secret-delete-user`, `wipe-club-vault` | Random string — internal admin gate |

### Config / IDs (non-secret but required)

| Var | Used by | Source |
|---|---|---|
| `SUPABASE_PAT` | `realtime-stats` | Supabase account → Access Tokens |
| `SUPABASE_PROJECT_REF` | `realtime-stats` | Supabase project settings (`yabcfiuntwqjwvschnji` for prod) |
| `SYSTEM_BOT_USER_ID` | `auto-default-rsvp-maintenance-cron` | UUID of the system bot profile row |
| `GAME_KICKOFF_TEAM_ALLOWLIST` | `notify-game-kickoff` | Comma-separated team UUIDs — feature flag |

---

## Auto-provided by Supabase (do NOT copy to vault)

These are injected automatically and regenerated per-project:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

---

## Disaster-recovery checklist

If prod is destroyed and you're restoring to a new Supabase project:

1. Restore DB from backup (all data returns).
2. Redeploy edge functions from this repo (automatic when the Lovable project points at the new Supabase).
3. From your password vault, re-add every secret in the tables above to the new project's Edge Function Secrets.
4. Re-issue endpoint-bound secrets that reference the new project URL:
   - `STRIPE_WEBHOOK_SECRET` — create a new webhook in Stripe pointing at the new function URL.
   - Google OAuth redirect URIs — update in Google Cloud console.
   - Apple/Google push credentials — no change (project-agnostic).
5. Verify a test flow per category (send test email, trigger test push, run a cron manually).
