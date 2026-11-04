# Six shortlisted changes: compatibility status, 4 November 2026

## Result: fresh PROD comparison blocked, no deployment

The accessible Supabase tools target DEV (`ecsdwrarzfexssxtrymj`), not PROD
(`yabcfiuntwqjwvschnji`). No PROD database credential is available in this workspace.
Paul's GitHub API (1) was used for read-only inspection of the live release workflow
and the workflow catalogue. The PROD branch still has the older deployment workflow
without safe-plan; main has the new staging mode, but its live job only runs on PROD.
Moreover, safe-plan reads migration versions, not the target definitions needed here.
No workflow was dispatched, repository file changed through GitHub, or database queried.
Running the PROD deployment workflow is not a read-only substitute.

The query in `six-candidate-prod-catalog.sql` is prepared for the PROD SQL Editor.
It reads bounded catalog metadata in a read-only transaction. It omits application
records, settings values, function bodies, credentials and scheduler commands.
Function/constraint/index/trigger fingerprints detect differences but cannot explain
changed bodies: any differing existing definition still needs a separately scoped
local review before approval. Query results do not establish account/signup hosted
settings, presence of the welcome-message system account, or live acceptance.

## Precisely proposed changes, not confirmed PROD deltas

| Change | Proposed effect | Current comparison and blocker |
|---|---|---|
| Profile country | Nullable `profiles.country` text; constraint allows NULL or two uppercase letters. No backfill or country assignment. | 30 Oct owner evidence says absent; current presence and existing constraint/data compatibility unverified. |
| Welcome message | Replace `send_welcome_dm(uuid,text)`; require caller's own user ID; find/create a system conversation and insert one welcome message when called. Revoke PUBLIC/anon, grant authenticated execution. | Existing function, grants, conversation/message constraints and system-account prerequisites unverified. Installation itself does not send messages. |
| Ladder setting | Add `competitions.hide_ladder boolean NOT NULL DEFAULT false` only if absent. No change to scores or hiding settings of an existing column. | 30 Oct owner evidence says already present; may be no-op. Current type/default/nullability unverified. |
| Duty team | Add nullable event duty-team reference with ON DELETE SET NULL and partial index; replace validator and create trigger. Future assigned teams must be active, non-shell, non-deleted and in the event's club. | 30 Oct evidence says column already present. Existing trigger name may collide; preserve deployed validator unless exact comparison establishes the intended delta. Team lifecycle columns must exist. |
| Competition admin inbox | Replace `ensure_competition_admin_thread(uuid)` and set authenticated execution. Caller must qualify through competition role or team/guardian/club membership. When called, find/create an admin-contact group, remove unrelated members from that selected group and add current admins/caller. | Not merely a visual change: runtime authorization/membership behavior changes. All joins, existing function behavior, unique constraints and triggers need verification. No existing groups changed by installation itself. |
| Email signup invite | Create two protected public functions and a separate BEFORE INSERT auth.users trigger. Missing/empty email-club list leaves signup open; armed list requires a qualifying invite; malformed non-array list denies. Existing profile creation is not replaced. | Existing signup triggers, invitation columns and config semantics need verification. Existing accounts/sign-in are not modified, but new signup can be blocked; representative signup acceptance required. No club list is activated by this file. |

All six remain held. No scores are copied or cleared; country backfills, automatic
reminder activation, AI, storage configuration and live history repairs are excluded.
The original six SQL sources are unchanged and bound by the safe-release manifest.
## PROD catalog comparison, 4 November 2026 (catalog CSV received)

Source: `Supabase_Snippet_Schema_Evidence_Collector_Catalog-Only.csv` (737 rows, read-only
catalog query run by Paul in the PROD SQL Editor). DEV function bodies compared by MD5.

| Change | PROD state | DEV state | Verdict |
|---|---|---|---|
| Profile country | `profiles.country` absent | absent | Stale — exists nowhere, app uses IP country detection instead. Skip. |
| Welcome message (`send_welcome_dm`) | absent | absent | Feature gap on BOTH: CompleteProfilePage calls it fire-and-forget, so it silently no-ops. Candidate, but untested in DEV — test there first. |
| Ladder setting (`hide_ladder`) | present: boolean, NOT NULL, has default — exact match | present | Already in PROD. No-op. |
| Duty team | column, validator and trigger all present; validator body MD5 `1b327779…` identical to DEV | present | Already in PROD. Migration as written would add a duplicate trigger (`events_validate_duty_team` vs existing `trg_validate_event_duty_team`) and duplicate index name — skip. |
| Competition admin inbox (`ensure_competition_admin_thread`) | absent | absent — superseded by `get_or_create_competition_admin_conversation`, which the app actually calls | Stale — do not deploy. |
| Email signup invite (Nov 4 separated trigger) | `email_signup_invite_allowed` and `enforce_email_signup_invite` absent; auth.users has only `on_auth_user_created` + `trg_auto_claim_eois` | present and tested | **The one change PROD needs.** Nov 4 version adds a separate BEFORE INSERT trigger and does not touch PROD's `handle_new_user` (body MD5 `7833daf2…`, differs from DEV's minimal `66cfda4d…`). |

All dependency columns verified present in PROD: teams lifecycle flags, direct_conversations/
direct_messages, pending_invites/team_invites/club_invites token columns, chat_groups
competition scope columns, group_members, competition_roles/entries, team_memberships,
club_players, children, child_guardians, child_team_assignments, user_roles.

Conclusion: of the six, only the email signup check needs to go to PROD, using the
November 4 separated-trigger migration only. Two are already live, three are stale.
No deployment authorized by this comparison.
