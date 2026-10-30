# Production Supabase checks — 30 Oct 2026 (read-only)

All facts below were returned by read-only queries run by the owner in the
production Supabase SQL Editor. Nothing in this file changes production.

## Verified production state

| Check | Result | Release consequence |
| --- | --- | --- |
| Newest migration | `20261029094707` | 10 files in this repo are still pending |
| `handle_new_user()` | inserts `public.profiles (id)` only | the guard migration keeps this insert unchanged and adds one check before it |
| Triggers on `auth.users` | profile creation + EOI email auto-claim | both stay; the guard rides inside the existing profile trigger |
| `app_settings` row `backend_routing_config` | **no rows** | the release must insert it, not update it |
| Anon read rule on `app_settings` | **absent** | signed-out visitors could not load the sign-in screen; must be added |
| `email_signup_invite_allowed(...)` | absent | must be created |
| `user_email_matches_invite(...)` | present | untouched |
| Invitation tables | `pending_invites`, `team_invites`, `club_invites` columns match the guard | guard query is compatible |
| `teams.id`, `teams.club_id` | both `uuid` | guard join is compatible |

## Retained-club IDs — corrected

Production clubs:

- Bridgewater Soccer Club — `966bdaec-ebf1-46da-b2b3-cc53bf05c422`
- Basket Range Cricket Club — `493ee2e3-c834-487d-93be-d1c8a0dbc4a8`

A DEV read of `clubs` and `backend_routing_config` returns the **same two IDs**.
The IDs first quoted during this review (`854fe733…`, `e48a41d9…`) do not exist
in either database and were a mis-transcription; they appear in no file in this
repository. The release migrations already carry the correct IDs, so no
migration edit is needed.

## Curated pending-migration list (10 files)

Run in production:

1. `20261030013157` — `email_signup_invite_allowed()` + `handle_new_user()` with the invitation check
2. `20261030013232` — function permission lockdown
3. `20261030013735` — inserts `backend_routing_config` with the two retained clubs
4. `20261030052009` — `score_review_ai_access` table (harmless; the AI tool is not activated)
5. `20261004045741` — anon read of only the `backend_routing_config` row, **if** query B shows it is not already recorded

Do not run in production:

- `20261030013444` — DEV test harness; inserts throwaway invitation rows
- `20261030014542`, `20261030014712` — repairs pinned to the DEV project/database identity
- `20261030030705`, `20261030030741`, `20261030031128` — self-removal work that aborts unless the DEV database identity matches

## Hosting check — closed by direct inspection

The owner's Netlify screen shows only the variables the Supabase extension
created (`SUPABASE_ANON_KEY`, `SUPABASE_DATABASE_URL`, `SUPABASE_JWT_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`) and no
`IGNITE_LIVE_*` entries. That is the expected layout, not a gap:

- The production database address is committed in `netlify.toml` under
  `[context.production.environment]`
  (`IGNITE_LIVE_SUPABASE_URL = https://yabcfiuntwqjwvschnji.supabase.co`), and
  the DEV address likewise under `[context.main.environment]`. Neither needs a
  UI variable, which is why the old branch always worked.
- The public key comes from the connected Supabase extension
  (`VITE_SUPABASE_PUBLISHABLE_KEY`), which `scripts/host-build-env.mjs` copies
  into `IGNITE_LIVE_SUPABASE_ANON_KEY`.
- `resolveHostBuildEnv()` refuses a production build unless the branch is
  `prod`, every database address present matches `yabcfiuntwqjwvschnji`, and
  every public key present is the same one. A DEV address or a mismatched key
  stops the build rather than shipping.

Evidence from the live site (read-only fetch, 30 Oct 2026 10:47 UTC):

- `https://igniteclubhq.app/` serves `assets/index-EGVlsjdc.js`.
- That bundle contains `https://yabcfiuntwqjwvschnji.supabase.co` (7 times) and
  no occurrence of the DEV project reference.
- The bundle contains neither `Sign in securely` nor `Sign in with email`,
  confirming the new tabbed sign-in is not yet in production — consistent with
  production still running the previously deployed release.

## Final query results — closed 30 Oct 2026 11:00 UTC

- Query A (tables the guard and release touch): all present in production.
- Query B (which of the five run-list versions are already recorded):
  **no rows**. None of `20261004045741`, `20261030013157`, `20261030013232`,
  `20261030013735` or `20261030052009` is in production's migration history.

Consequences:

1. Nothing on the run list is partially applied, so there is no drift to
   reconcile — all five still need to run.
2. `20261004045741` is not a DEV-pinned repair: it is a plain
   `GRANT SELECT ON public.app_settings TO anon` plus a policy restricted to
   `key = 'backend_routing_config'`. It applies unchanged to production and is
   the fix that lets a signed-out visitor load the tabbed sign-in screen.
3. `20261030013735` carries the verified production club IDs
   (`966bdaec…` Bridgewater, `493ee2e3…` Basket Range) and uses
   `ON CONFLICT (key) DO UPDATE`, so it works whether or not the row exists —
   production currently has none.

`scripts/auth-release-policy.json` still holds `20261030013735` as
`blocked` with the reason "Activates DEV club IDs; must not execute in
PROD". That reason is stale — the migration file carries the production IDs —
but the hold itself stays until the owner approves the release.

## Owner decision — 30 Oct 2026, 11:05 UTC: hold

The owner chose not to merge yet. No merge, no production migration run and no
deployment occurred; production keeps serving the previously released version.

The verified state above stays valid. Resuming needs only the owner's
go-ahead: the run list is the five versions named in the curated
pending-migration list, applied in filename order. Everything else is prepared
— the candidate build succeeds with both sign-in entries, tab switching and
secure refresh pass in the packaged copy, and the hosting settings were
confirmed by direct inspection of the live site.

## Still outstanding

- Owner go-ahead to merge and run the five run-list migrations.
- Post-release: real-account sign-in flows and real-phone notifications.
- Nothing outstanding on the release shape: the owner accepted the single
  `backend_routing_config` settings row, so the run list stays exactly as listed.

## Owner rule — 30 Oct 2026, 11:02 UTC: structures only, no production data

The owner requires that the merge change **only structures** and that no production
data be changed. The five run-list migrations were checked against that rule by
`scripts/prod-release-no-data.test.mjs` (7 checks, all passing):

| Version | What it changes | Rows written |
| --- | --- | --- |
| `20261030013157` | creates `email_signup_invite_allowed()`, replaces `handle_new_user()` | none — its only table write is the `profiles (id)` insert the signup trigger already performs |
| `20261030013232` | function permission lockdown (`REVOKE`/`GRANT`) | none |
| `20261030013735` | adds the `backend_routing_config` settings row | **one settings row** |
| `20261030052009` | creates the empty `score_review_ai_access` table plus RLS | none |
| `20261004045741` | `GRANT SELECT` to anon plus a policy limited to `key = 'backend_routing_config'` | none |

The one unavoidable write is `20261030013735`. Production holds no
`backend_routing_config` row at all, so without it the new sign-in screen has no
settings to read. It is a single application-configuration row: an upsert keyed on
`key` that replaces only `value` and `updated_at`, so it cannot duplicate itself or
touch any other settings row, and it names no member, club record, score or message.

Everything else on the run list is structure and permissions. No run-list migration
deletes, truncates, merges or drops anything, none names the DEV project, and none
writes a club, team, member, event, RSVP, chat, score or notification row. The
excluded files stay out of production — `20261030013444` would have inserted
throwaway invitation rows, and the five DEV-pinned repairs would abort rather than
run.

### Owner decision — 30 Oct 2026, 11:04 UTC: the settings row is accepted

The owner confirmed the single settings row may stay in the release, so it is a named
and approved part of the plan rather than an open question. It is bounded by test
(`scripts/prod-release-no-data.test.mjs`): a run-list migration may insert only the
key `backend_routing_config`, may carry only the two retained club IDs with
`defaultBackend` left as `supabase`, and may update only `value` and `updated_at`.
Any other settings key, or any further row, fails the release check and needs a fresh
owner decision.

This approval covers the shape of the release only. It is not a go-ahead to merge:
`docs/release-review/smaller-release-owner-approval.json` still records
`mergeAuthorized: false`, and production remains on the previously deployed version.

