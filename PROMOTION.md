# Dev → Prod Promotion Process

This document describes the complete process for promoting changes from the dev environment (`main` branch) to production (`prod` branch). It covers frontend, backend, mobile (Codemagic), and the GitHub PR workflow.

## Architecture Overview

| Branch | Frontend | Backend (Supabase) | Mobile Track |
|--------|----------|-------------------|--------------|
| `main` | Netlify dev site | `ignite-dev` project | Codemagic dev → TestFlight Internal + Play Internal |
| `prod` | Netlify prod site | `yabcfiuntwqjwvschnji` (prod) | Codemagic prod → App Store + Play Store |

**Key rule:** Lovable edits `main`. Nothing ever edits `prod` directly except the merge PR described below.

---

## Pre-Requisites

Before you can promote, ensure the following are set up:

### GitHub Repository
- Two branches: `main` (default) and `prod`
- GitHub Actions enabled

### GitHub Actions Secrets (Settings → Secrets and variables → Actions)
| Secret | Value | How to get it |
|--------|-------|---------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token | https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROD_PROJECT_REF` | `yabcfiuntwqjwvschnji` | Supabase dashboard → prod project → Project Settings → General |
| `SUPABASE_DB_PASSWORD` | Prod DB password | Supabase dashboard → prod project → Project Settings → Database → Connection string / Password |

### Supabase Pro Plan (Prod only)
- Point-in-Time Recovery (PITR) enabled: Supabase dashboard → prod project → Database → Backups → Point in Time Recovery
- This is a one-time setup and is your safety net

### Netlify
- Two sites configured: one for dev (builds from `main`), one for prod (builds from `prod`)
- The prod site only rebuilds when the GitHub Actions promotion workflow succeeds

### Codemagic
- Two workflows configured in `codemagic.yaml`: dev track and prod track
- Dev track deploys to TestFlight Internal and Google Play Internal
- Prod track deploys to App Store and Google Play Store
- The prod track only triggers when the `prod` branch updates AND the GitHub Actions promotion succeeds

---

## The Promotion Process (Step by Step)

### Step 1: Test on Dev

Verify your changes thoroughly before opening a PR:

1. **Lovable Preview:** Check the feature in the Lovable preview URL
2. **Netlify Dev:** Visit the dev URL and verify frontend behavior
3. **Supabase Dev:** If you made DB changes, verify them in the dev Supabase project
4. **Mobile (if applicable):** If the change touches native features (push notifications, camera, etc.), install the latest TestFlight Internal or Play Internal build and test

**Do not skip this step.** Once a PR is merged to `prod`, the automated pipeline runs immediately.

---

### Step 2: Open a Pull Request (main → prod)

1. Go to your GitHub repository
2. Click **Pull requests → New pull request**
3. Set **base:** `prod`, **compare:** `main`
4. Give the PR a clear title describing what is shipping (e.g., "Add write audit log and drop CLI marker table")
5. In the PR description, list:
   - What changed (high level)
   - Any new Supabase migrations (check the diff — these will run against prod)
   - Any new or updated edge functions
   - Any frontend changes that need visual QA
   - Any mobile-specific changes

**Review the diff carefully.** Pay special attention to:
- `supabase/migrations/` — these SQL files will execute on the live prod database
- `supabase/functions/` — these will be redeployed to prod
- Any destructive changes (DROP TABLE, ALTER COLUMN, etc.)

---

### Step 3: Get Approval and Merge

1. Request review from the appropriate team member(s)
2. Address any feedback
3. Once approved, **merge the PR** (do not rebase — use a merge commit so `prod` has a clear history of what came from `main`)

**What happens next is fully automated.**

---

### Step 4: Watch the GitHub Action

On merge to `prod`, the `.github/workflows/promote-to-prod.yml` action runs automatically:

| Step | What it does |
|------|-------------|
| 1. Verify secrets | Confirms `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`, and `SUPABASE_DB_PASSWORD` are present |
| 2. Link to prod | Links the Supabase CLI to the prod project |
| 3. Backup prod | Runs `pg_dump` (schema, data, and roles) and uploads as a GitHub Actions artifact (retained 30 days) |
| 4. Apply migrations | Runs `supabase db push` — applies any new migration files from `supabase/migrations/` |
| 5. Deploy edge functions | Runs `supabase functions deploy` — redeploys all edge functions to prod |

**Go to your repo → Actions tab → "Promote to Prod" workflow and watch it.**

- **If it goes green (✅):** Backend is promoted. Netlify and Codemagic will now automatically build the frontend/mobile against the same commit.
- **If it goes red (❌):** See "Rollback" below. The frontend has **not** been rebuilt — Netlify and Codemagic only trigger on a successful action.

---

### Step 5: Verify Production

Once the GitHub Action is green:

1. **Frontend:** Check the Netlify prod URL
2. **Backend:** Verify migrations applied correctly in the prod Supabase dashboard (Database → Migrations)
3. **Edge Functions:** Check the prod Supabase dashboard (Edge Functions) to confirm they deployed
4. **Mobile:** Codemagic will have started a prod build. Monitor the Codemagic dashboard. Once complete, the build will be submitted to App Store / Play Store (or TestFlight / Play Internal depending on your Codemagic config).

---

## Rollback Procedures

### If the GitHub Action fails during migrations

**The prod frontend has NOT been rebuilt.** Users see no change. But the DB may be partially migrated.

1. Open the Action logs and find the failing SQL statement
2. Choose one path:
   - **Fix forward (recommended):** Patch the migration file on `main`, open a new PR to `prod`, merge again. The action will re-run from the backup step.
   - **Manual unwind:** Use the Supabase SQL editor to undo the partial change, then fix forward.

### If prod is broken after a green promotion

**Frontend regression only:**
- Revert the merge commit on `prod`:
  - Option A: Use GitHub's "Revert" button on the PR
  - Option B: Locally: `git revert -m 1 <merge-commit-sha>`, then push to `prod`
- Netlify and Codemagic will rebuild the previous version automatically

**Database regression:**
- Write a **new** migration that undoes the bad change and promote it the normal way
- **Never** delete or rewrite a migration file that has already run against prod — `supabase db push` tracks applied migrations by filename

### Disaster Recovery (in order of preference)

1. **Forward reverse-migration** — write a new migration that undoes the bad change and promote it normally. Zero data loss. Best for schema mistakes caught after legitimate writes have landed.

2. **Supabase PITR** — dashboard → Database → Backups → Point in Time. Restore prod to any exact second within the 7-day retention window. Covers `public` schema, `auth.users`, and `storage`. Best for bad migrations, accidental mass deletes, or corruption.

3. **Pre-promotion artifact restore** — last resort:
   - Go to Actions → Promote to Prod → the bad run → Artifacts → download `prod-backup-*.tar.gz`
   - Set `SUPABASE_DB_URL` to the prod connection string
   - Run `./scripts/restore-prod-backup.sh path/to/backup.tar.gz`
   - **Warning:** This DESTROYS anything written since the backup and does NOT restore `auth.users` or `storage`
   - After restore, revert the frontend by re-promoting the prior commit to `prod`
   - Consider replaying the gap window using the write audit log (see PROMOTION.md "Gap-Data Recovery")

---

## What NOT To Do

- ❌ **Don't edit `prod` directly.** Always merge from `main`.
- ❌ **Don't run `supabase db push` from your laptop against prod.** Only the GitHub Action should touch prod.
- ❌ **Don't copy data from prod → dev or vice versa via the promotion flow.** Data copies are manual: Supabase dashboard → Database → Backups → Restore to another project.
- ❌ **Don't rename or delete migration files after they've been applied.** Supabase tracks applied migrations by filename.

---

## Codemagic Specifics

The `codemagic.yaml` in the repo root defines two build tracks:

| Workflow | Trigger | Destination |
|----------|---------|-------------|
| `android-debug-workflow` / `ios-debug-workflow` | `main` branch push or manual | TestFlight Internal / Google Play Internal |
| `android-prod-workflow` / `ios-prod-workflow` | `prod` branch push (after GitHub Action succeeds) | App Store / Google Play Store |

**Key points:**
- The prod Codemagic workflows should be configured to only run after the GitHub Actions promotion succeeds, or they will build against a commit whose backend hasn't been promoted yet
- Version codes are auto-generated (epoch-based) so every build is unique
- The `.env` file committed to the repo points to dev Supabase. For prod builds, ensure Codemagic overrides `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the prod values (either via Codemagic environment variables or a build script)

---

## PR Template (Copy into GitHub)

```markdown
## What's shipping
[Describe the change in 1-2 sentences]

## Backend changes
- [ ] New migrations: [list files]
- [ ] New edge functions: [list names]
- [ ] Updated edge functions: [list names]
- [ ] No backend changes

## Frontend changes
- [ ] New pages / components
- [ ] Updated existing UI
- [ ] No frontend changes

## Mobile impact
- [ ] Affects native features (camera, push, etc.)
- [ ] No mobile impact

## Testing
- [ ] Tested on dev (Lovable preview + Netlify dev)
- [ ] Tested on mobile (TestFlight Internal / Play Internal) if applicable
- [ ] DB migrations verified on dev

## Risk assessment
- [ ] Low risk (UI only, no DB changes)
- [ ] Medium risk (DB migrations are additive only)
- [ ] High risk (destructive DB changes, auth changes, payment changes)
```

---

## Quick Reference Checklist

Before every promotion:

- [ ] Feature tested on dev
- [ ] PR opened: `main` → `prod`
- [ ] Diff reviewed, especially `supabase/migrations/`
- [ ] PR approved
- [ ] PR merged (merge commit, not rebase)
- [ ] GitHub Action "Promote to Prod" watched until completion
- [ ] If green: verified on prod frontend, backend, and mobile
- [ ] If red: followed rollback procedure, fixed forward, re-promoted
