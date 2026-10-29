# Ignite Club HQ — Staged Plan (DEV first, prod later)

## Where we're heading

```text
 main (this Lovable project) ──► TEST canisters ──► DEV database (ecsd…)
        │
        │ merge main → prod   (only when you're confident; git migrates PROD db)
        ▼
 prod ──► LIVE canister groups ──► igniteclubhq.app ──► PROD database
      ──► Codemagic phone apps                      ──► PROD database
```

Rule: test surfaces use DEV, live surfaces use PROD. No merge to `prod` until you approve it.

## Stage 1 — Get DEV set up properly (all on main, nothing live)
1. I make builds choose the database by branch: `main` → DEV, `prod` → PROD (fixes the earlier "everything uses DEV" default before it can ever reach prod).
2. I repoint the demo-data helper away from the old address.
3. Redeploy the canister `proe7-…` from `main` so it becomes the TEST canister on DEV.
4. Deploy the 3 deferred edge functions on DEV.

## Stage 2 — Test DEV thoroughly
1. Checklist on preview + test canister + a Codemagic DEV build: sign-in (email, Google, Internet Identity), events/RSVP, chats/polls, competitions/hidden scores, Vault/photos, notifications.
2. I record results in a short DEV readiness report; you sign off.

## Stage 3 — Prepare LIVE canisters (built, not switched on)
1. Add a separate "live" canister set, pointed at PROD database.
2. Workflow that deploys them only on merge into `prod`, after the database migration step.
3. Canister groups split the same way; existing club photos stay in their current group.

## Stage 4 — Go live (only with your go-ahead)
1. Merge `main` → `prod`: git migrates PROD db, Netlify updates igniteclubhq.app, Codemagic builds apps, live canisters deploy.
2. Later: add igniteclubhq.app to the live canister, update sign-in/app links, switch DNS from Netlify, then retire Netlify.

## What I need from you
- Go-ahead for Stage 1.
- PROD database project ID (or where it's set), so `prod` builds are wired correctly.
- `DEPLOYER_PEM` added to GitHub secrets (needed for the canister redeploy).
