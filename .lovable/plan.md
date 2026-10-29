# Ignite Club HQ — Staged Release Plan

## Where we're heading

```text
 main branch (this Lovable project)  ──►  TEST canisters (auto-deploy on push)
        │ merge main → prod
        ▼
 prod branch  ──►  LIVE canister groups  ──►  igniteclubhq.app
              ──►  Codemagic phone apps (same code, same database)
```

One database for every surface: `ecsdwrarzfexssxtrymj`.

## Today (for reference)
- igniteclubhq.app = Netlify, built from GitHub.
- Canister site `proe7-…` = a copy deployed from `main`, still on the OLD database until redeployed.
- Lovable "Publish" only updates ignite-club-launchpad.lovable.app (test site).

## Stage 1 — Get today's release safe (no hosting changes)
1. I repoint the demo-data helper to the right database.
2. You check Netlify and Codemagic settings for any old `cdrx…` database values and remove them.
3. You add `DEPLOYER_PEM` to GitHub secrets.
4. Merge `main` → `prod`; Netlify updates igniteclubhq.app; Codemagic builds the apps.

## Stage 2 — Make the existing canister the TEST canister
1. Redeploy canister `proe7-…` from `main` so it uses the right database.
2. Test sign-in (email, Google, Internet Identity) and key features there.
3. From now on, every push to `main` updates this test canister automatically.

## Stage 3 — Create LIVE canisters for prod
1. I add a second set of canister settings for "live" (separate canister IDs).
2. I add a workflow that deploys live canisters only when `main` is merged into `prod`.
3. First run creates the live canisters; their IDs are saved so later runs upgrade in place.
4. Live canister groups (backend/media) get the same split: test group on main, live group on prod. Existing club photos stay in their current group (per policy).

## Stage 4 — Point igniteclubhq.app at the live canister
1. Register igniteclubhq.app as a custom domain on the live canister.
2. Update Internet Identity and app-link settings for the new host.
3. Switch DNS from Netlify to ICP; keep Netlify as a fallback for a few weeks, then retire it.

## Stage 5 — After-merge leftovers (not blockers)
- Deploy the 3 deferred edge functions via Supabase CLI.

## What I need from you
- Approval to start Stage 1 (my part).
- Screenshots from Netlify and Codemagic settings for Stage 1 step 2.
- Each later stage starts only when you say go.
