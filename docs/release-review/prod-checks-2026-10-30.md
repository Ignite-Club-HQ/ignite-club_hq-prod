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

## Still outstanding

- Query A: do the tables the guard and release touch all exist in production?
- Query B: which of the five run-list versions are already recorded?
- Post-release: real-account sign-in flows and real-phone notifications
