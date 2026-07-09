# Ignite Club — Secrets & Credentials Vault Guide

**Goal:** Get every credential this app depends on out of "only in Supabase / only in my head" and into a proper password manager, so you can recover from a lost account, laptop, or Supabase project.

> **Note:** You said "BitLocker" — that's Windows disk encryption, not a password manager. The tool you want is **Bitwarden** (free, cross-platform password manager). Instructions below assume Bitwarden. If you already use 1Password / Dashlane / Apple Passwords, the structure is identical — just create the equivalent vault and folders there.

---

## Part 1 — Bitwarden setup (once, ~5 min)

1. Go to **https://bitwarden.com** → **Get Started** → create a free account.
   - Use a personal email you'll always have access to.
   - Master password: long, memorable, **write it down on paper and put it somewhere safe** (e.g. home safe). If you lose it, everything is gone — there is no recovery.
2. Turn on 2FA: Settings → Security → Two-step Login → Authenticator App (use Google Authenticator or Authy on your phone). Save the recovery code somewhere offline.
3. Install the browser extension (Chrome/Safari/Firefox) and the mobile app — same account.
4. Create an **Organisation** (free tier allows 1 org, 2 users):
   - Name: `Ignite Club`
   - Invite your co-admin by email.
5. Inside the organisation, create these **Collections** (Bitwarden's term for folders):
   - `1. Platform Logins` — accounts (Supabase, Lovable, Stripe, Resend, etc.)
   - `2. Edge Function Secrets — Prod`
   - `3. Edge Function Secrets — Dev`
   - `4. Database & Infrastructure`
   - `5. Third-Party API Keys`

You're ready. Now fill each collection using Parts 2–5 below.

---

## Part 2 — Platform Logins (do this first, most important)

For each row: in Bitwarden, click **+ New → Login**, set the Name, URL, username, password. Save to Collection `1. Platform Logins`.

| Item name | URL | What to save |
|---|---|---|
| Supabase account | https://supabase.com/dashboard | Email + password + 2FA recovery codes |
| Lovable account | https://lovable.dev | Email + password (or note "Google SSO") |
| Stripe account | https://dashboard.stripe.com | Email + password + 2FA recovery codes |
| Resend account | https://resend.com | Email + password |
| Firebase / Google Cloud | https://console.cloud.google.com | Which Google account owns the project |
| Giphy developer | https://developers.giphy.com | Email + password |
| Apple Developer (if publishing iOS) | https://developer.apple.com | Apple ID + password + 2FA device |
| Google Play Console (if publishing Android) | https://play.google.com/console | Email + password |
| Domain registrar (igniteclubhq.app) | wherever you bought it | Login + 2FA |
| GitHub (if repo is mirrored) | https://github.com | Login + 2FA recovery codes |

**Why this matters most:** if you lose access to the *account*, you can't rotate the *keys*. Account recovery is often slow (days/weeks for Apple, Stripe). Getting the login credentials into Bitwarden protects you from lockout.

---

## Part 3 — Database & Infrastructure (Collection 4)

Create these as Bitwarden **Secure Notes** (+ New → Secure Note) unless noted.

| Item | Where to find it | Notes |
|---|---|---|
| Supabase DB password (prod) | Supabase dashboard → Project Settings → Database → Reset database password (only shown once on reset) | Needed for direct psql access / migrations from local |
| Supabase DB password (dev) | Same, on the dev project | |
| Supabase project ref (prod) | `yabcfiuntwqjwvschnji` — already known | Non-secret but handy |
| Supabase project ref (dev) | Dev project dashboard → Settings → General | |
| Supabase Personal Access Token (PAT) | Supabase → Account → Access Tokens → Generate new | Used by `realtime-stats` function |
| Supabase service_role key (prod) | Project Settings → API → service_role | **NEVER put in client code.** Backup copy only. |
| Supabase anon key (prod) | Project Settings → API → anon | Public, but handy to have |
| Supabase URL (prod) | Project Settings → API | |
| Firebase FCM service account JSON | Firebase console → Project Settings → Service Accounts → Generate new private key | Save the whole downloaded JSON file as an attachment on the Bitwarden note |
| VAPID key pair | Generated with `npx web-push generate-vapid-keys` | Save both public + private — regenerating invalidates existing web push subscriptions |
| Apple push cert (if iOS push used) | Apple Developer → Certificates | .p12 file + password, attach both |

---

## Part 4 — Edge Function Secrets (Collections 2 & 3)

For **each** secret below, in Bitwarden create a **Login** item (Login type makes the value copy-with-one-click):
- **Name:** the secret name exactly (e.g. `STRIPE_WEBHOOK_SECRET`)
- **Username:** leave blank or put "prod" / "dev"
- **Password field:** paste the secret value
- **Notes field:** paste the "Used by" list and "Source" line from below
- **Collection:** `2. Edge Function Secrets — Prod` (repeat for dev if different values)

### How to get the values

1. Open the prod Supabase dashboard → **Edge Functions** → **Secrets** (or Settings → Edge Functions → Secrets).
2. Go through the list **in the exact order below** — this matches how they appear grouped in this doc. Click the eye icon 👁 on each row to reveal the value, copy it, paste into Bitwarden, save.
3. Repeat for the dev project into Collection 3 (dev values may differ or may be missing — that's fine, note which are absent).

### Order to work through (top to bottom)

**Payments (1)**
1. `STRIPE_WEBHOOK_SECRET` — used by `stripe-webhook`. Source: Stripe → Developers → Webhooks → endpoint signing secret.

**Email (1)**
2. `RESEND_API_KEY` — used by 9 email functions (`send-email`, `auth-email-hook`, `send-*-email`). Source: Resend → API Keys.

**Push notifications (7)**
3. `FCM_SERVICE_ACCOUNT` — full JSON blob. Source: Firebase → Service Accounts.
4. `FCM_CLIENT_EMAIL` — `client_email` from the JSON.
5. `FCM_PRIVATE_KEY` — `private_key` from the JSON.
6. `FCM_PROJECT_ID` — `project_id` from the JSON.
7. `VAPID_PUBLIC_KEY` — used by `check-vapid-key`, `send-push-notification`. Source: web-push CLI.
8. `VAPID_PRIVATE_KEY` — same pair.
9. `VAPID_SUBJECT` — `mailto:` address, non-sensitive but required.

**AI (2)**
10. `GEMINI_API_KEY` — used by `digest-messages`, `summarize-chat`. Source: Google AI Studio → API keys.
11. `LOVABLE_API_KEY` — used by `auth-email-hook`. Source: managed by Lovable (rotate via Lovable tools if needed — don't manually edit).

**Third-party integrations (4)**
12. `GIPHY_API_KEY` — used by `giphy-search`. Source: Giphy developers.
13. `GOOGLE_PLACES_API_KEY` — used by `google-places-search`. Source: Google Cloud → APIs & Credentials.
14. `GOOGLE_CLIENT_ID` — used by `drive-folder-sync`, `google-drive-import`, `resolve-drive-titles`. Source: Google Cloud → OAuth 2.0 Client IDs.
15. `GOOGLE_CLIENT_SECRET` — same OAuth client.

**Cron / internal auth (3)**
16. `CRON_SECRET` — used by 15 cron functions (`auto-purge-trash`, `expire-subscriptions`, `send-*-reminders`, etc.). Source: random string you generated; must also match the header value in `pg_cron` jobs.
17. `AUTO_RSVP_DM_CRON_SECRET` — used by 3 RSVP cron functions. Source: same, random string.
18. `ADMIN_DELETE_SECRET` — used by `secret-delete-user`, `wipe-club-vault`. Source: random string, internal admin gate.

**Config / IDs (4 — technically not secret, but back them up)**
19. `SUPABASE_PAT` — used by `realtime-stats`. Source: Supabase → Account → Access Tokens.
20. `SUPABASE_PROJECT_REF` — `yabcfiuntwqjwvschnji` for prod.
21. `SYSTEM_BOT_USER_ID` — UUID of the system bot profile row (query `profiles` table).
22. `GAME_KICKOFF_TEAM_ALLOWLIST` — comma-separated team UUIDs (feature flag).

**Total: 22 secrets to copy.** Budget ~15 minutes.

---

## Part 5 — Auto-provided secrets (skip these)

Don't bother copying these — Supabase regenerates them per-project and injects them automatically:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

(The prod service_role key **is** worth backing up separately as an emergency admin token — see Part 3.)

---

## Part 6 — Ongoing hygiene

- **When you add a new edge secret:** add it to Bitwarden the same day, and add a row in this doc.
- **When you rotate a secret:** update Bitwarden and note the rotation date in the item's notes field.
- **When you add a co-admin:** invite them to the Bitwarden organisation and share the relevant collections. Do NOT DM/email secrets.
- **Quarterly:** open this doc and verify every listed secret still exists in both Supabase and Bitwarden (drift check).

---

## Part 7 — Disaster-recovery runbook

If prod Supabase is destroyed and you're restoring to a new project:

1. Restore DB from Supabase point-in-time backup (all app data returns).
2. Edge functions redeploy automatically once Lovable points at the new Supabase project.
3. Open Bitwarden → Collection 2 → paste every secret into the new project's Edge Function Secrets.
4. Re-issue anything URL-bound to the old project:
   - **Stripe webhook:** create a new endpoint at the new function URL, copy the new signing secret into Bitwarden **and** Supabase (overwriting the old `STRIPE_WEBHOOK_SECRET`).
   - **Google OAuth redirect URIs:** update in Google Cloud console to point at the new project URL.
   - **FCM / VAPID / Resend:** no change — provider-side, project-agnostic.
5. Update `pg_cron` job headers with `CRON_SECRET` / `AUTO_RSVP_DM_CRON_SECRET` if you rotated them.
6. Smoke test per category: send a test email, trigger one push notification, run one cron manually, run a Stripe test payment.

Recovery time with this doc + Bitwarden populated: **~1 hour**.
Without it: days to weeks (and probably permanent loss of some third-party integrations).
