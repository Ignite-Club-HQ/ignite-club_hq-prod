
# Dev / Prod Environment Split

Reuses your existing `main` / `prod` branch topology. Adds a parallel Supabase project for dev, dual Capacitor bundle IDs, dev-track mobile builds, and an automated promotion workflow that keeps frontend + backend in lockstep.

## Final Topology

```text
                 ┌──────────── main branch ────────────┐
Lovable edits ──►│ Netlify preview  │ Codemagic (dev)  │──► Supabase DEV
                 │ (auto-deploy)    │ TestFlight Intl. │    (ignite-dev)
                 │                  │ Play Internal    │
                 └──────────────────┴──────────────────┘
                            │
                            │  PR: main → prod
                            ▼
                 ┌──────────── prod branch ────────────┐
                 │ GitHub Action:                       │
                 │   1. supabase db push  ──────────────┼──► Supabase PROD
                 │   2. supabase functions deploy       │    (existing)
                 │   3. On success → Netlify + Codemagic│
                 │      build against prod              │
                 └──────────────────────────────────────┘
```

Data never crosses. Code + migrations promote as one atomic PR.

## What Gets Built

### 1. Second Supabase project (`ignite-dev`)
- You create it on the Supabase free tier (£0; auto-pauses after 7 idle days, wakes on next request).
- I generate a one-shot seed migration bundle (schema + policies + functions from current prod) for you to run against dev on first setup.
- Storage buckets and edge-function secrets: you copy over manually (I'll produce a checklist).

### 2. Environment-aware app code
- `src/integrations/supabase/client.ts` continues reading `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — Netlify + Codemagic inject different values per branch, no code change needed.
- New `src/lib/env.ts` exports `IS_DEV_ENV` (derived from Supabase URL match) and logs `[env] supabase=<host>` at boot.
- New `<DevRibbon />` component — small "DEV" badge fixed top-right, only renders when `IS_DEV_ENV`.

### 3. Dual Capacitor configs
- `capacitor.config.ts` reads `process.env.LOVABLE_ENV`:
  - `LOVABLE_ENV=prod` → `appId: app.lovable.ignite`, `appName: Ignite`
  - anything else → `appId: app.lovable.ignite.dev`, `appName: Ignite DEV`
- Installs side-by-side on the same phone.

### 4. Netlify wiring (you configure in Netlify UI, I document exact values)
- Site A (existing prod site): watches `prod`, env = Supabase PROD keys.
- Site B (new dev site): watches `main`, env = Supabase DEV keys. Netlify auto-generates the URL.

### 5. Codemagic wiring (you configure, I document)
- Existing prod workflow: unchanged (watches `prod`, prod bundle ID, App Store/Play).
- New dev workflow: watches `main`, sets `LOVABLE_ENV=dev`, dev bundle ID, distributes to TestFlight Internal + Play Internal Testing.

### 6. GitHub Action: `.github/workflows/promote-to-prod.yml`
- Trigger: push to `prod`.
- Steps (in order, hard-fails if any step errors):
  1. Install Supabase CLI.
  2. `supabase link --project-ref $SUPABASE_PROD_PROJECT_REF`
  3. `supabase db push` — applies any new `supabase/migrations/*.sql` files.
  4. `supabase functions deploy --project-ref $SUPABASE_PROD_PROJECT_REF`
  5. Success → Netlify + Codemagic auto-trigger on the same commit and build the frontend.
- If migrations fail, frontend never ships → no schema/UI mismatch possible.

### 7. Repo docs
- `PROMOTION.md` — one-page checklist: "how to promote main → prod", "how to roll back", "what to do if a migration fails halfway."

## Your Manual Steps (I can't do these for you)

1. Create `ignite-dev` project in Supabase dashboard → give me the project ref.
2. Generate Supabase personal access token at supabase.com/dashboard/account/tokens → save in password manager.
3. Add three GitHub Actions secrets to your repo:
   - `SUPABASE_ACCESS_TOKEN` (from step 2)
   - `SUPABASE_PROD_PROJECT_REF` = `yabcfiuntwqjwvschnji`
   - `SUPABASE_DEV_PROJECT_REF` = (from step 1)
4. Create Netlify Site B pointing at `main`, paste dev Supabase keys as env vars.
5. Duplicate Codemagic workflow to watch `main` with `LOVABLE_ENV=dev` + dev signing cert.
6. Run the seed migration bundle against dev Supabase (one-time, from Supabase SQL editor — I'll give you the file).
7. Copy edge-function secrets from prod Supabase → dev Supabase (I'll list which ones).

## Playback — What I Will Do In Code

When you approve this plan, I will, in one pass:

1. **Create `src/lib/env.ts`** — env detection + boot log.
2. **Create `src/components/DevRibbon.tsx`** — conditional DEV badge.
3. **Mount `<DevRibbon />`** in `src/App.tsx` (top level, above routes).
4. **Rewrite `capacitor.config.ts`** — env-switched appId/appName, keep existing plugin config.
5. **Create `.github/workflows/promote-to-prod.yml`** — the migrate-then-deploy action.
6. **Create `PROMOTION.md`** at repo root — checklist + rollback steps.
7. **Create `SETUP-DEV-ENV.md`** at repo root — your step-by-step for the 7 manual steps above, with exact URLs, commands, and env-var names.
8. **Generate the seed migration file** at `supabase/migrations/_seed-dev-from-prod.sql` (marked as manual-run only, not picked up by `db push` — has a comment header explaining this).

I will **NOT**:
- Touch the existing prod Supabase project.
- Touch `main` branch behavior (Lovable continues editing here as normal).
- Change any existing edge functions, RLS policies, or tables.
- Modify the current Netlify or Codemagic prod pipeline.

Everything above is additive. If you decide to abandon the split later, deleting the two docs, the workflow file, `env.ts`, `DevRibbon.tsx`, and reverting `capacitor.config.ts` returns you to today's exact state.

## Risk Recap
- Zero risk to prod Supabase (never written to during setup).
- Zero risk to prod Netlify site (different branch).
- Zero risk to App Store / Play listings (different bundle ID for dev).
- Only real risk: forgetting which environment you're testing → mitigated by DEV ribbon + boot log.
