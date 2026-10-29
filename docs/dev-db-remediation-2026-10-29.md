# DEV DB remediation — 2026-10-29

Scope: the approved DEV-only compatibility migrations, plus read-only evidence on hosted Edge Functions and sign-in settings. Source report: `docs/dev-db-compatibility-2026-10-29.md`.

## 1. Verified target and pinned sources

| Item | Value |
|---|---|
| Connected database | `ecsdwrarzfexssxtrymj` (Ignite Club HQ DEV). Checked against the project env and the connected-project context before any write. |
| Production `yabcfiuntwqjwvschnji` | Not connected, not queried, not changed. |
| `main` (re-pinned) | `43f516a8bddb5cf1f001eda7fd3f9800015899af` (2026-10-29T02:50Z). It is 3 commits past the old pin `96642d07`. Files changed: `bun.lock`, `docs/dev-db-compatibility-2026-10-29.md` and `src/integrations/supabase/previewAuthStorage.ts`. None of them touch SQL contracts. |
| `integration-hybrid` | `70d821c8a58791e4523a1ba4972bf009af90af6c`, unchanged. Compare is now **diverged**: 8,070 ahead and 3 behind the new main. A merge must now take main's 3 commits into account; the "fast-forward-equivalent" assumption in the earlier report no longer holds. |
| Hybrid SQL used as the source of truth | `20261008014417`, `20261022030115`, `20261021003048` and `20261021003143` (final grant fix), `20261014010000`, `20261014030000`, `20261012000000`, `20261012020000`, `20261010000000`, `20261015185653`, plus the final storage lock-down in `20261022042733` and `20261022092625`. `read_competition_playhq` exists only in `docs/competition-history-preservation-layer.sql`, so that file was used for it. |

The full historical migration directory was **not** run.

## 2. Migrations applied (retained in the repo)

| File | Contents |
|---|---|
| `supabase/migrations/20261029030811_95cf86e6-…sql` | Columns, history/results/fixture RPCs and helpers |
| `supabase/migrations/20261029031008_fa1a98bb-…sql` | Email invites, Competition Vault access and storage policies, settings tables, revoking the helpers |
| `supabase/migrations/20261029031121_0f6c559d-…sql` | Tightens grants on the new settings tables: DEV default privileges had given anon full access and authenticated TRUNCATE |
| Bucket (storage tool) | `competition-vault`: private, 10 MB limit |

## 3. Approved items

The verification evidence below comes from fresh `pg_proc`, `information_schema` and `pg_policies` reads, `has_*_privilege` checks, and live REST calls described in §6.

| Item | Status | Evidence / notes |
|---|---|---|
| `clubs.home_country` | **APPLIED** | `text`, nullable, no default. Check `clubs_home_country_check`: `home_country IS NULL OR ~ '^[A-Z]{2}$'`. 0 rows non-null. The hybrid `UPDATE … SET 'AU'` backfill was **deliberately not applied** (no invented values). The hybrid `clubs.backend` column and lock trigger were not approved and not added. |
| `club_subscriptions.pricing_version` | **APPLIED** | `text NOT NULL DEFAULT 'legacy'`. Every existing row is `legacy`, so nothing was upgraded. Existing table grants were inherited unchanged. Not added (not approved): `paid_extra_teams`, `team_subscriptions.pricing_version`, `subscription_price_catalog`, new enum values, and the capacity/entitlement triggers. |
| `read_game_history(p_team_id uuid=NULL, p_club_id uuid=NULL, p_limit int=100) → jsonb` | **APPLIED** | SECURITY DEFINER, `search_path=public`. Signed-in only (anon 401/42501 verified). Requires a team or club scope. Returns at most 100 rows, filtered by access first. |
| `read_game_result(p_event_id uuid) → jsonb` | **APPLIED** | Same DTO and masking as the hybrid version. |
| `save_game_history(p_result jsonb, p_only_if_missing bool=false) → void` | **APPLIED** | Validation verified live: invalid input is rejected with 22023 and no write. Competition events need a competition admin. Other events need `can_manage_game_result`. **DEV adaptation:** when the competition hides scores, the function writes only `competition_match_results` and never `game_results`. This keeps DEV's existing rule of deleting game results when scores are hidden. |
| `read_history_player_stats(p_team_id, p_event_id=NULL, p_from=NULL, p_to=NULL) → jsonb` | **APPLIED** | Goals and assists are nulled when scores are hidden. |
| `read_history_report_events(p_team_id) → jsonb` | **APPLIED** | |
| `read_history_summary(p_event_id) → jsonb` | **APPLIED** | |
| `get_my_viewable_competition_match_ids() → TABLE(match_id uuid)` | **APPLIED** | Hybrid semantics: competition owner/admin or league_admin of the organising club. Plain player and team admin both get 0 rows (verified). **Not changed:** the hybrid `competition_admins_read_fixture_events` policy on `events`, which is outside the approved scope. DEV already has its own fixture visibility (`is_league_admin_for_competition`). |
| `read_competition_playhq(p_competition_id) → jsonb` | **APPLIED** | Returns `{matches, stats, links}` and requires `can_view_competition`. Stats and links are filtered by score visibility. The hybrid RESTRICTIVE policies on `playhq_fixtures`/`playhq_player_stats` were **not** applied; they belong to the wider RLS review. |
| `save_competition_match_result(p_match_id, p_home_score, p_away_score, p_status) → void` | **APPLIED** | Requires a competition admin (non-admin got 42501, verified). Note: DEV RLS still lets officials (referee/scorer) write `competition_match_results` directly, while the hybrid RPC is admin-only. |
| Supporting helpers | **APPLIED (internal)** | `can_manage_competition_vault` (= `is_competition_admin`, the hybrid's final definition), `competition_scores_visible`, `history_scores_visible`, `can_read_history_row`, `history_result_dto` and `mask_history_players`. EXECUTE is revoked from anon and authenticated (signed-in call got 403, verified). Score hiding reuses DEV's `match_scores_hidden`, which hides when either the competition or the division hides; DEV divisions are NOT NULL. **Not added:** the hybrid history columns on `game_results`/`events`, the `scores_stored_separately` constraint, the pending-score redirect triggers, the RESTRICTIVE history policies and the replacement of `sync_competition_match_events`. DEV already separates scores in its own way; the linkage comes from `events.competition_match_id`. |
| `competition_role_email_invites` | **APPLIED** | Columns, checks and the 48h expiry match the hybrid table. RLS is on. Only competition admins can SELECT. Grants: authenticated SELECT only, service_role ALL, anon none, no TRUNCATE. `accepted_user_id` is a plain uuid with no auth.users foreign key, following project rules. |
| `create_competition_role_email_invite(_competition_id, _role, _token, _email, _verification_code_hash) → uuid` | **APPLIED** | Requires a competition admin (non-admin got the error, verified). |
| `get_competition_role_email_invite_status(p_token) → TABLE(status, competition_id, competition_name, role)` | **APPLIED** | Callable by anon and authenticated (hybrid contract). An unknown token returns one `invalid` row (verified). |
| `accept_competition_role_email_invite(p_token, p_verification_code_hash) → TABLE(status, competition_id, role)` | **APPLIED** | Checks: verified email, exact email match, code hash, lock after 5 attempts, expired/revoked refused, archived refused. **Correction:** the hybrid inserted `committee_member` into `competition_roles`, whose check only allows `committee`, so accepting would have failed. It now maps to `committee`. The API still reports `committee_member`. Success path not exercised (see §6). |
| `revoke_competition_role_email_invite(_token) → boolean` | **APPLIED** | Admin-scoped. An unknown token returns `false` (verified). |
| `can_access_competition_vault(_competition_id) → boolean` | **APPLIED** | Signed-in only. Team admin = true, plain player = false (verified). The plain player is false because they are linked only through `user_roles` and have no active `team_memberships`/`club_players` row; that is the hybrid's rule. |
| `competition-vault` bucket and storage policies | **APPLIED** | Private, 10 MB, matching the hybrid upload cap. Paths must be `clubs/<organiser club>/competitions/<competition>/…`. Read: permissive and restrictive `competition_vault_storage_access(name,false)`. Delete: manage. INSERT and UPDATE are blocked for anon and authenticated, which is the hybrid's final state (writes go through the server measured-upload service only). Anon read is blocked. The DEV `vault_folders`/`vault_files` competition policies were **left unchanged**: they are stricter, admin-only, and widening them was not approved. |
| `club_invite_message_defaults` | **APPLIED** | `(club_id pk → clubs, message)`. Club members can read; club admins can insert, update and delete. Grants: authenticated S/I/U/D, service_role ALL, anon none. The hybrid file had **no GRANTs** and public-role policies; both were corrected. |
| `welcome_email_settings` | **APPLIED** | Hybrid shape plus an `updated_at` trigger. **Correction:** the hybrid called `can_manage_team_roster(team_id, auth.uid())` with the arguments reversed; it is now `(auth.uid(), team_id)`. Grants: authenticated S/I/U (hybrid), service_role ALL. **Not added:** `welcome_email_deliveries`, `claim_/finish_welcome_email_delivery` and `is_welcome_email_recipient`. These are needed by `send-welcome-email` but were not approved. |
| `canister_memory_reports` | **APPLIED** | App admins only. Grants: authenticated S/I, service_role ALL. The plain player sees `[]` (verified). |

Security linter: the remaining new warnings are signed-in EXECUTE on the 15 intended RPCs plus anon EXECUTE on `get_competition_role_email_invite_status`. Each function checks the caller and scope inside. The pre-existing ~770 findings are unchanged and were not addressed.

## 4. Edge Function evidence (read-only)

- **Deployed inventory: UNVERIFIED.** No authenticated management interface that lists deployed functions was available to me. There were no function-edge or edge-function logs in the last 30 days, so deployment and version timestamps and source revisions cannot be confirmed. **Evidence needed:** a redacted screenshot or export of DEV Dashboard → Edge Functions (name, last deployed, version), or `supabase functions list --project-ref ecsdwrarzfexssxtrymj`.
- **Repository source** (not deployment evidence): current checkout has 120 functions; hybrid has 123. Present only in hybrid: `send-welcome-email`, `send-welcome-email-icp` and `verify-iap-receipt-icp`.
- **Caller gaps (hybrid code):**
  - `create-member-checkout` is invoked but has no source in either branch.
  - The three hybrid-only functions above are not in DEV source, so they are presumed not deployed.
  - `send-welcome-email` also needs the delivery SQL that was not approved (§3).
- **Auth configuration** per function (`verify_jwt`): only the repo `supabase/config.toml` is available, which is source and not hosted evidence. Hosted settings are UNVERIFIED.
- **Secret names** (redacted interface; values not read): `CRON_SECRET`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`, `GEMINI_API_KEY`, `GIPHY_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LOVABLE_API_KEY` (managed), `NEW_CLUB_ALERT_SECRET`, `SEND_EMAIL_HOOK_SECRET` and `TEST_PASS`. Mapping each function's required names against this list is still open; for example, any email-provider key for welcome emails is not present.

## 5. Hosted sign-in evidence (read-only)

Source: the public DEV `GET /auth/v1/settings` endpoint (anon key, no credentials exposed).

| Setting | DEV hosted value |
|---|---|
| Email provider | enabled |
| Google, Apple and all other OAuth providers | **disabled** |
| Phone | disabled |
| Anonymous users | disabled |
| Signup | allowed (`disable_signup=false`) |
| Email confirmation | required (`mailer_autoconfirm=false`) |
| SAML / passkeys | disabled |

**UNVERIFIED** (not exposed publicly; no management access): Site URL, additional redirect allowlist, custom email template identifiers, and the send-email hook configuration. A `SEND_EMAIL_HOOK_SECRET` secret exists, which suggests a hook, but that is not confirmed. **Evidence needed:** a redacted screenshot of Auth → URL Configuration and Auth → Emails/Hooks.

Callback URLs the hybrid code uses, to check against the allowlist:

- Signup `emailRedirectTo`: `${origin}/` or `${origin}/auth?redirect=<path>`.
- Password reset `redirectTo`:
  - Web: `${origin}/verify-reset-code?email=<redacted>`.
  - Native: `https://igniteclubhq.app/verify-reset-code?email=<redacted>`.
- Native deep links: `igniteclubhq://` and `com.igniteclubhq.app://ii-callback`.
- Universal links: `https://igniteclubhq.app/...`.
- Google Drive: `https://igniteclubhq.app/vault` on native, `${origin}/vault` on web.

Possible mismatches: the allowlist cannot be compared because it was not readable. Google sign-in in the code would fail on DEV because the Google provider is disabled.

## 6. Tests run and behaviour still unverified

- `src/test/devCompatibilityMigrations.guard.test.ts`: 8 static contract and security tests, all passed. They cover no country backfill, legacy pricing, no score columns, signatures, signed-in-only grants, the hidden-score save path, email-invite checks, the vault write block and the settings-table grants.
- Live REST checks (`/tmp/verify/rpc_check.py`) as anon, plain player `mock.blue2` and team admin `mock.blue1`:
  - Anon is refused on all signed-in RPCs.
  - Internal helpers return 403.
  - Validation and permission refusals behave as expected.
  - Vault access is correct for admin vs player.
  - RLS on the invites and canister tables is correct.
  - Listing `competition-vault` returns 200 (empty).
  - Side effect: the two DEV mock accounts were signed in, which records a sign-in time. No other data was written.
- **Unverified:**
  - Positive write paths: `save_game_history`, `save_competition_match_result`, invite create/accept/revoke success, settings upserts and vault downloads/deletes. These were not run because they would write data or create notifications.
  - Visible-score history for a non-hidden competition. Women's Masters hides scores, so history returned `[]` for its teams.
  - Uploads to `competition-vault`, which depend on the measured-upload server function and the reservation SQL, neither of which is in DEV.

## 7. Remaining essential merge/activation blockers

1. Branch divergence: hybrid is 3 commits behind the new main and must be reconciled.
2. Edge Function deployed inventory, auth and secrets mapping are unverified. `create-member-checkout` has no source. The welcome-email and ICP functions are not in DEV.
3. Welcome-email delivery SQL (`welcome_email_deliveries` and its functions) and the measured-media upload SQL are not approved or applied, so Competition Vault uploads and welcome emails cannot work yet.
4. Hosted Auth URL configuration and templates are unverified. Google OAuth is disabled on DEV.
5. Code-side corrections from the earlier report are still needed in hybrid code (not schema): `profiles.full_name/first_name/email`, `teams.age_group`, `events.start_at`, `team_memberships.user_id`, `club_players.user_id`, `mini_leagues.status` and `user_roles.mini_league_id`.
6. Signed-in DEV acceptance of the positive write paths in §6.
7. **Outstanding Realtime (separate, not authorised here):** `active_games`, `chat_pinned_vault`, `club_subscriptions` and `member_payments` are not published.
8. **Wider RLS/Storage review (separate, not authorised here):**
   - Broad storage predicates.
   - Public PlayHQ reads; the hybrid RESTRICTIVE PlayHQ and history policies were not applied.
   - Hybrid `events` fixture-read policy.
   - Hybrid widening of the competition Vault table policies.
   - Officials vs admin result-entry parity.
   - Pre-existing linter findings.

Merge readiness is **not** declared.

## 8. Confirmation

Untouched: production, hosted deployment settings (Netlify/Codemagic), workflows, Edge Function deployments, secrets, Auth settings and canisters. No emails, notifications, payments, imports, backfills or data cleanup were triggered.

## 9. Follow-up verification — 2026-10-29 (read-only)

Edge functions and RLS are per-project; DEV runs its own deployed set. Live checks against `ecsdwrarzfexssxtrymj`:

- `send-welcome-email`, `verify-iap-receipt-icp`, `create-member-checkout` → **404 NOT_FOUND on DEV** (not deployed). Control `check-vapid-key` → 200, confirming the endpoint probing works.
- Realtime publication confirmed via `pg_publication_rel`: 20 tables published; `active_games`, `chat_pinned_vault`, `club_subscriptions`, `member_payments` remain **not published**.
- **New finding:** DEV VAPID keys are misconfigured — `check-vapid-key` reports invalid key pair (keys exist but do not match / wrong lengths). Push notifications will not work on DEV until regenerated.

Classification: merge-critical DEV items are branch divergence, the missing edge functions plus their SQL (welcome-email deliveries, measured upload), code-side field fixes, and the realtime gaps. Hosted Auth config and the wider RLS/Storage review are not DEV merge blockers.
