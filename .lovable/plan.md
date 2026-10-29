# Ignite Club HQ — Simple Release Plan

## The big picture (what exists today)

```text
                 GitHub repo (Ignite-Club-HQ/ignite-club_hq-prod)
                 ├── main  ← this Lovable project writes here
                 └── prod  ← what live users get
                          │
     ┌────────────────────┼─────────────────────────┐
     ▼                    ▼                         ▼
 igniteclubhq.app     Phone apps               ICP canister site
 (Netlify, LIVE)      (Codemagic → stores)     (proe7-…icp0.io, test copy)
```

- One database for everything: `ecsdwrarzfexssxtrymj` (this project's).
- Lovable "Publish" only updates ignite-club-launchpad.lovable.app — a test site. It does not touch prod.
- The canister site still points at the OLD database until it is redeployed.

## Step 1 — Tidy up (I do this, here)
1. Repoint the demo-data helper's old address to the correct database.
2. Confirm every surface's settings point at `ecsd…` (code side).

## Step 2 — Check settings that only you can see (10 minutes)
1. Netlify dashboard → Site configuration → Build & deploy: note which branch it deploys (should be `prod`) and remove any old database URL/key variables.
2. Codemagic → environment variables: remove or repoint any `IGNITE_LIVE_SUPABASE_URL` / `IGNITE_LIVE_SUPABASE_ANON_KEY` pointing to `cdrx…`.
3. GitHub → Settings → Secrets: add `DEPLOYER_PEM` (needed for the canister deploy).

## Step 3 — Test before going live
1. Use the Lovable preview to test sign-in (email, Google, Internet Identity), events, chats, polls, competitions.
2. Run the canister deploy workflow on `main`; test the canister site against the right database.

## Step 4 — Release to prod
1. GitHub: Pull request base `prod` ← compare `main`, merge.
2. Netlify rebuilds igniteclubhq.app automatically.
3. Codemagic: run Android and iOS builds on `prod`, then submit to the stores.

## Step 5 — After release (not blockers)
- Deploy the 3 deferred edge functions (welcome email, ICP receipt checks) via Supabase CLI.
- Later: move igniteclubhq.app from Netlify to the canister (sign-in links must be updated first).

## What I need from you
- Answer to Step 2 checks (screenshots are fine).
- Go-ahead to start Step 1.
