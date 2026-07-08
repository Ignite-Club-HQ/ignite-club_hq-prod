# Promoting `main` → `prod`

This project uses a two-branch pipeline:

| Branch | Frontend host | Backend (Supabase) | Mobile track |
|--------|--------------|--------------------|--------------|
| `main` | Netlify dev site | `ignite-dev` project | Codemagic dev → TestFlight Internal + Play Internal |
| `prod` | Netlify prod site | prod project (`yabcfiuntwqjwvschnji`) | Codemagic prod → App Store + Play Store |

Lovable edits `main`. Nothing ever edits `prod` directly except the merge PR
described below.

---

## Standard promotion

1. **Test on dev.** Verify the change in the Lovable preview, the Netlify dev
   URL, and (if it touches native features) the TestFlight Internal /
   Play Internal build.
2. **Open a PR: `main` → `prod`.** Title it with what's shipping. Review the
   diff — pay special attention to any new files under `supabase/migrations/`.
   Those are the DB changes that will run against prod.
3. **Merge the PR.** On merge, GitHub Actions
   (`.github/workflows/promote-to-prod.yml`) runs automatically:
   1. Links to prod Supabase
   2. `supabase db push` — applies new migrations
   3. `supabase functions deploy` — deploys edge functions
   4. If both succeed, Netlify + Codemagic build the frontend against the
      same commit
4. **Watch the Action** (repo → Actions tab). If it goes green, prod is
   consistent. If it goes red, see rollback below.

---

## Rollback

### If the GitHub Action fails during migrations

- The prod frontend has **not** been rebuilt yet — Netlify + Codemagic only
  trigger on a successful Action. Users see no change.
- The DB may be partially migrated. Open the Action logs, find the failing
  SQL statement, and either:
  - Fix forward: patch the migration file on `main`, merge to `prod` again,
    re-run.
  - Manually unwind the partial change in the Supabase SQL editor, then fix
    forward.

### If prod is broken after a green promotion

- **Frontend regression only:** revert the merge commit on `prod`
  (`git revert -m 1 <sha>` locally, push, or use GitHub's "Revert" button).
  Netlify + Codemagic will rebuild the previous version.
- **DB regression:** write a *new* migration that undoes the change and
  promote it the normal way. Never delete or rewrite a migration file that
  has already run against prod — `supabase db push` tracks applied
  migrations by filename.

---

## Disaster recovery stack (Supabase Pro — PITR enabled)

Prod is on the Supabase **Pro plan with Point-in-Time Recovery (PITR)**
enabled. Recovery options, in order of preference:

1. **Forward reverse-migration** — write a new migration that undoes the bad
   change and promote it normally. Zero data loss. Use for schema mistakes
   caught after some legitimate writes have already landed.
2. **Supabase PITR** (dashboard → Database → Backups → Point in Time) —
   restore prod to any exact second within the retention window (7 days on
   Pro by default). Covers everything: `public` schema, `auth.users`,
   `storage`. Use for bad migrations, accidental mass deletes, corruption
   caught within the window.
3. **Pre-promotion artifact restore** (`scripts/restore-prod-backup.sh`) —
   last-resort nuclear restore from the GitHub Actions tarball. Use only if
   PITR is unavailable or the incident is older than the PITR window.
   DESTROYS anything written since the backup and does NOT restore
   `auth.users` or `storage`.

**Enabling PITR:** Supabase dashboard → prod project → Database → Backups →
Point in Time Recovery → enable. One-time setup.

---

## What NOT to do


- ❌ Don't edit `prod` directly. Always merge from `main`.
- ❌ Don't run `supabase db push` from your laptop against prod. Only the
  GitHub Action should touch prod.
- ❌ Don't copy data from prod → dev or vice versa via the promotion flow.
  Data is manual (Supabase → Database → Backups → Restore to another project).
- ❌ Don't rename or delete migration files after they've been applied.

## Rolling back a bad promotion

Every promotion runs `supabase db dump` against prod *before* applying
migrations, and uploads the result as a GitHub Actions artifact
(`prod-backup-<timestamp>-<sha>.tar.gz`, retained 30 days).

Options in order of preference:

1. **Forward reverse-migration** (safe, no data loss) — write a new migration
   that undoes the bad change, PR → merge to `prod` as normal.
2. **Supabase PITR** — dashboard → Database → Backups. Point-in-time restore.
3. **Nuclear restore from the pre-promotion artifact** — DESTROYS anything
   written to prod since the backup:
   1. Actions → Promote to Prod → the bad run → Artifacts → download the tarball.
   2. `export SUPABASE_DB_URL='postgresql://postgres:<PWD>@db.<REF>.supabase.co:5432/postgres'`
   3. `./scripts/restore-prod-backup.sh prod-backup-*.tar.gz`
   4. Revert the frontend by re-promoting the prior commit to `prod`.
