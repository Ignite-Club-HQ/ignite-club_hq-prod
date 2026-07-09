# Dev → Prod Promotion Checklist

Two Supabase projects:
- **Dev**: `ecsdwrarzfexssxtrymj` (Lovable-connected, auto-updated)
- **Prod**: `yabcfiuntwqjwvschnji` (promoted via `.github/workflows/promote-to-prod.yml`)

Two Codemagic mobile workflows per platform:
- `android-debug-workflow` / `ios` → dev Supabase → **Internal testing** track
- `android-workflow` / `ios-workflow` → prod Supabase → **Production** track

---

## 1. GitHub Actions secrets (one-time)

Repo → Settings → Secrets and variables → Actions:

- [ ] `SUPABASE_ACCESS_TOKEN` — https://supabase.com/dashboard/account/tokens
- [ ] `SUPABASE_PROD_PROJECT_REF` = `yabcfiuntwqjwvschnji`
- [ ] `SUPABASE_DB_PASSWORD` — prod DB password (Prod project → Settings → Database)

## 2. Codemagic env groups (one-time)

Codemagic UI → Environment variables:

- [ ] `supabase_prod` group with `VITE_SUPABASE_PUBLISHABLE_KEY` (prod anon key)
- [ ] `android_signing` group (keystore vars)
- [ ] `app_store_connect` / `firebase` groups if used

## 3. Prod Supabase — Edge Function secrets

Set in prod project → Edge Functions → Secrets. Mirror dev, using **prod-flavoured
values** (live Stripe keys, prod FCM project, etc.) where applicable.

Auto-provided by Supabase (don't set manually):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` / `ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Must set manually in prod:

**Google / OAuth**
- [ ] `GOOGLE_CLIENT_ID` (prod OAuth client)
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GOOGLE_PLACES_API_KEY`

**Push notifications (FCM)** — decide: same Firebase project as dev, or a prod one
- [ ] `FCM_PROJECT_ID`
- [ ] `FCM_CLIENT_EMAIL`
- [ ] `FCM_PRIVATE_KEY`
- [ ] `FCM_SERVICE_ACCOUNT` (JSON)

**Web push (VAPID)**
- [ ] `VAPID_PUBLIC_KEY`
- [ ] `VAPID_PRIVATE_KEY`
- [ ] `VAPID_SUBJECT`

**Payments**
- [ ] `STRIPE_WEBHOOK_SECRET` (from the **prod** Stripe webhook)
  - Remember to also set the Stripe secret/publishable keys your functions use
    (whichever names — check current dev secrets and mirror).

**AI / integrations**
- [ ] `LOVABLE_API_KEY` (auto-provisioned per project — verify it exists)
- [ ] `GEMINI_API_KEY`
- [ ] `GIPHY_API_KEY`
- [ ] `RESEND_API_KEY`

**Cron / internal**
- [ ] `CRON_SECRET`
- [ ] `AUTO_RSVP_DM_CRON_SECRET`
- [ ] `ADMIN_DELETE_SECRET`
- [ ] `SYSTEM_BOT_USER_ID` (create the bot user in prod first, then paste its uuid)
- [ ] `GAME_KICKOFF_TEAM_ALLOWLIST`
- [ ] `SUPABASE_PAT` (personal access token, if any function calls the Management API)
- [ ] `SUPABASE_PROJECT_REF` = `yabcfiuntwqjwvschnji`

## 4. Prod Supabase — Auth config

- [ ] Site URL set
- [ ] Redirect URLs include: `igniteclubhq://`, prod web domain(s),
      `https://igniteclubhq.app/*`
- [ ] Google provider — prod OAuth client id/secret
- [ ] Email templates match dev (or custom SMTP configured)
- [ ] Any other providers enabled in dev

## 5. Prod Supabase — Storage / Realtime

- [ ] Storage buckets created (avatars, chat-media, vault, etc. — mirror dev)
- [ ] Realtime publications include the same tables as dev
- [ ] Cron jobs (pg_cron) scheduled — migrations should handle these; verify

## 6. Prod Supabase — System data

- [ ] Create the "system bot" user in prod auth → copy uuid into `SYSTEM_BOT_USER_ID`
- [ ] Seed any lookup tables the app needs (roles, default clubs, etc.)
- [ ] First app_admin account provisioned

## 7. Universal Links / App Links

Both dev and prod builds share bundle id `app.lovable.igniteteamhub`.

- [ ] `https://igniteclubhq.app/.well-known/assetlinks.json` (Android SHA256)
- [ ] `https://igniteclubhq.app/.well-known/apple-app-site-association` (iOS)

## 8. Release loop

```
1. Build & test in Lovable          → dev Supabase (auto)
2. QA on device via Codemagic dev   → Internal testing track
3. GitHub PR: main → prod, merge    → promote-to-prod.yml runs:
                                         • backs up prod DB
                                         • pushes migrations
                                         • deploys all edge functions
4. Trigger Codemagic prod workflow  → signed .aab / .ipa on `prod` branch
5. Upload to Play Console Production + App Store Connect
```

## 9. Rollback

The Actions run uploads `prod-backup-*.sql.gz` (30-day retention).
Restore procedure lives in `scripts/restore-prod-backup.sh`.
