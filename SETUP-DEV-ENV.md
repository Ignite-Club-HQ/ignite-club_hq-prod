# One-time Dev Environment Setup

You only run through this once. After it's done, promoting `main` → `prod`
is fully automated (see [`PROMOTION.md`](./PROMOTION.md)).

Estimated time: **~45 minutes** end-to-end.

---

## Step 1 — Create the dev Supabase project

1. Go to https://supabase.com/dashboard → **New project**.
2. Name: `ignite-dev`. Region: same as prod. Password: generate and save in
   your password manager.
3. Wait for provisioning (~2 min).
4. Copy the **Project ref** (20-char string, e.g. `abcdefghijklmnopqrst`)
   from the URL: `https://supabase.com/dashboard/project/<REF>`.
5. Copy the **anon key** and **project URL** from Project Settings → API.

> Free tier includes 2 projects. `ignite-dev` will auto-pause after 7 days
> of zero activity; the first request after that wakes it in ~30 s.

---

## Step 2 — Tell the app about the dev project ref

Edit `src/lib/env.ts` and add your dev project ref to `DEV_PROJECT_REFS`:

```ts
const DEV_PROJECT_REFS: readonly string[] = [
  "abcdefghijklmnopqrst", // ignite-dev — paste your ref here
];
```

Commit to `main`. This is what makes the DEV ribbon appear and the boot
log identify the env correctly.

---

## Step 3 — Seed the dev database

The easiest safe seed is a **schema-only clone** (no user data crosses):

1. In prod Supabase → **Database → Backups** → create a manual backup.
2. Download it, or use `pg_dump --schema-only` if you have DB access.
3. In dev Supabase → **SQL Editor** → paste and run the schema dump.
4. Alternatively, ask Lovable to generate a consolidated seed migration
   from the current `supabase/migrations/` folder.

After seeding, dev has the same tables, RLS, functions, and triggers as
prod, but zero rows.

---

## Step 4 — Copy edge-function secrets to dev

Go to prod Supabase → **Project Settings → Edge Functions → Secrets** and
list every secret. For each one, decide:

- **Copy as-is** (webhooks pointing at 3rd-party services that don't care
  about env): `LOVABLE_API_KEY`, most integrations.
- **Use a dev-specific value** (payments, email senders): create a Stripe
  test key, a dev SendGrid sender, etc.

Add each secret to dev Supabase → **Project Settings → Edge Functions →
Secrets**.

---

## Step 5 — Generate a Supabase personal access token

1. Go to https://supabase.com/dashboard/account/tokens.
2. **Generate new token** → name it `github-actions-promotion`.
3. **Copy the value immediately** — Supabase hashes it after this screen and
   you cannot see it again. Save in your password manager.

---

## Step 6 — Add GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add all three:

| Name | Value |
|------|-------|
| `SUPABASE_ACCESS_TOKEN` | Token from Step 5 |
| `SUPABASE_PROD_PROJECT_REF` | `yabcfiuntwqjwvschnji` |
| `SUPABASE_DB_PASSWORD` | Prod DB password (Supabase → Project Settings → Database) |

`SUPABASE_DEV_PROJECT_REF` is not required by the current workflow (the
workflow only touches prod). Add it later if you want a similar
auto-migrate action for dev.

---

## Step 7 — Set up Netlify dev site

1. Netlify → **Add new site → Import from Git** → same GitHub repo.
2. **Production branch: `main`** (yes, `main` is dev's "production" on this
   second site).
3. Build command / publish dir: same as your prod site (`npm run build` /
   `dist`).
4. **Site configuration → Environment variables** → add:
   - `VITE_SUPABASE_URL` = dev project URL from Step 1
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = dev anon key from Step 1
   - `VITE_SUPABASE_PROJECT_ID` = dev project ref from Step 1
5. Trigger a deploy. Confirm the DEV ribbon appears top-right and the
   browser console prints `[env] supabase=<dev-ref>.supabase.co mode=DEV`.

Do **not** change any env vars on the existing prod site.

---

## Step 8 — Set up Codemagic dev workflow

1. Codemagic → your app → **duplicate the prod workflow**. Rename to
   `dev`.
2. **Triggering:** change from `prod` branch to `main` branch.
3. **Environment variables:**
   - `LOVABLE_ENV = dev`
   - `VITE_SUPABASE_URL` = dev project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = dev anon key
   - `VITE_SUPABASE_PROJECT_ID` = dev project ref
4. **Signing:** use a separate dev signing certificate + provisioning
   profile matching the dev bundle ID `app.lovable.igniteteamhub.dev`
   (create it in App Store Connect / Play Console first).
5. **Distribution:**
   - iOS: TestFlight Internal Testing only (no external testers, no
     App Store submission)
   - Android: Google Play Internal Testing only
6. Trigger a build. Install on your phone — it should install alongside
   the prod app (different icon label, "Ignite DEV").

---

## Step 9 — Verify the loop

1. Make a small visible change on `main` in Lovable (e.g. tweak a heading).
2. Confirm it appears on the Netlify dev URL within ~2 min.
3. Confirm Codemagic dev triggers and lands in TestFlight Internal.
4. Open a PR `main` → `prod` with that commit. Merge it.
5. Watch the GitHub Action run (should be green with no migrations to
   apply).
6. Confirm Netlify prod + Codemagic prod pick it up.

If all 6 succeed, the pipeline is live. From now on, only steps 1–5 above
happen for every feature; the setup is done.
