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

## What NOT to do

- ❌ Don't edit `prod` directly. Always merge from `main`.
- ❌ Don't run `supabase db push` from your laptop against prod. Only the
  GitHub Action should touch prod.
- ❌ Don't copy data from prod → dev or vice versa via the promotion flow.
  Data is manual (Supabase → Database → Backups → Restore to another project).
- ❌ Don't rename or delete migration files after they've been applied.
