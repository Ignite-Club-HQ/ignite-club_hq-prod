# Ignite Club HQ — Staged Release Plan

## Where we're heading

```text
 main (this Lovable project) ──► TEST canisters ──► DEV database (ecsd…)
        │
        │ merge main → prod   (git already migrates the PROD database)
        ▼
 prod ──► LIVE canister groups ──► igniteclubhq.app ──► PROD database
      ──► Codemagic phone apps                      ──► PROD database
```

Rule: test surfaces talk to DEV, live surfaces talk to PROD. Your existing merge already promotes database changes — we keep that as is.

## Stage 1 — Release safely today (no hosting changes)
1. I make sure builds from `prod` pick the PROD database and builds from `main` pick DEV (fix the earlier "everything uses DEV" default).
2. I repoint the demo-data helper so it never hits the wrong database.
3. You confirm Netlify and Codemagic's PROD settings hold the PROD database address/key (screenshot is fine).
4. Merge `main` → `prod`: git migrates PROD database, Netlify updates igniteclubhq.app, Codemagic builds apps.

## Stage 2 — Make the existing canister the TEST canister
1. Redeploy canister `proe7-…` from `main`, pointed at DEV.
2. Test sign-in (email, Google, Internet Identity) and key features.
3. Every push to `main` updates it automatically from then on.

## Stage 3 — Create LIVE canisters for prod
1. Add a separate "live" canister set (own IDs), pointed at PROD database.
2. New workflow deploys live canisters only on merge into `prod`, after the database migration step.
3. Live canister groups (backend/media) split the same way; existing club photos stay in their current group.

## Stage 4 — Point igniteclubhq.app at the live canister
1. Add igniteclubhq.app as a custom domain on the live canister.
2. Update Internet Identity and app-link settings.
3. Switch DNS from Netlify to ICP; keep Netlify as fallback briefly, then retire it.

## Stage 5 — Leftovers (not blockers)
- Deploy the 3 deferred edge functions on DEV, then they promote with the normal merge.

## What I need from you
- Go-ahead for Stage 1 (my part).
- PROD database project ID (or confirm where it's set) so I wire `prod` builds correctly.
- Each later stage starts only when you say go.
