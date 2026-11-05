# Remaining feature compatibility vs PROD — 2026-11-04

Source: `Supabase_Snippet_Schema_RLS_Introspection_Report_for_Selected_Objects.csv`
(1,515 rows, run by Paul in the PROD SQL Editor against `yabcfiuntwqjwvschnji`).
Read-only catalog evidence; no data values, no function bodies beyond fingerprints.

## Verdict per feature group

| # | Feature group | PROD status | Finding |
|---|---------------|-------------|---------|
| 1 | Email signup guard | **Missing** | `email_signup_invite_allowed` and `enforce_email_signup_invite` both absent. Approved; awaiting main→prod merge. |
| 2 | Email-club config | Table present, row unknown | `app_settings` exists; catalog does not read row values. `backend_routing_config` row needs separate PROD config with PROD club IDs. |
| 3 | Welcome DM + profile country | **Missing** | `send_welcome_dm` absent; `profiles.country` absent. Now on DEV; needs DEV acceptance test, then PROD release. |
| 4 | Club country | **Missing** | `clubs.country` absent. Separate from profile country; old migration also backfills "Australia" (data write — held). |
| 5 | Competition events | **Present, version uncertain** | `create_competition_event`, `can_create_competition_event`, `events.competition_id` all present. But `competition_event_operations` and `competition_event_audience` tables absent — PROD likely runs the legacy RPC. Needs signature comparison before any change. |
| 6 | Competition photos/news | **Partial** | `photos.competition_id`, `can_manage_competition_media`, `club_news_competition_ids`, `notify_club_news`, `validate_club_news_audience` present. Missing: `is_competition_media_member`, `is_competition_news_admin`, `validate_club_news_mini_league_audience`, `club_news.competition_id` column. |
| 7 | Invitation message defaults | **Missing** | `club_invite_message_defaults` table absent. |
| 8 | Team invitations / fixture / requester profile | **Partial** | `can_invite_players_to_team` present. Missing: `can_view_competition_fixture_event`, `can_view_pending_role_request_profile`. |
| 9 | Official links / invitations | **Partial** | Link flow present (`accept_competition_role_link`, `get_competition_role_link_status`, `invite_competition_official`, `claim_competition_role_invites_on_profile_create`). Email-invite flow missing: `competition_role_email_invites` table and all 4 email-invite functions absent. |
| 10 | Competition role removal | **Present** | `tg_competition_roles_enforce_owner`, `tg_competition_role_sync_chat`, `tg_competition_role_sync_contact_chats` all present. Body comparison still recommended before declaring parity. |
| 11 | Memory reports | **Missing** | `canister_memory_reports` table absent (admin diagnostics). |
| 12 | Competition Vault | **Partial** | `vault_folders.competition_id` and `vault_files.competition_id` columns present. All 4 access functions absent: `can_access_competition_vault`, `can_manage_competition_vault`, `can_access_vault_folder`, `can_access_vault_file`. |
| 13 | Welcome-email / reminder jobs | **Missing (post-merge anyway)** | `welcome_email_settings`, `welcome_email_deliveries`, `icp_welcome_email_deliveries` absent. Classified post-merge work, not merge blockers. |
| 14 | Scores / AI / free-media cleanup | **Missing (held)** | `get_my_viewable_competition_match_ids` absent (hidden scores — held). `club_is_paid`, `list_expired_free_media`, `purge_expired_free_media_rows` absent (free-media cleanup deletes rows when called — held). |

## Columns confirmed present in PROD

- `competitions.hide_ladder` (boolean, not null, has default)
- `events.duty_team_id` (uuid, nullable)
- `events.competition_id`, `photos.competition_id`, `vault_folders.competition_id`, `vault_files.competition_id` (uuid, nullable)

## Columns confirmed absent in PROD

- `profiles.country`, `clubs.country`, `club_news.competition_id`

## What this means for release order

1. **Approved and ready:** email signup guard (group 1) — merge main→prod.
2. **Real gaps worth releasing after DEV testing:** welcome DM + profile country (3), invitation message defaults (7), competition news admin helpers (6 partial), competition vault access functions (12 partial), official email invites (9 partial), memory reports (11).
3. **Needs deeper comparison first:** competition events (5) — PROD has a working version; do not overwrite blindly.
4. **Likely already fine:** competition role removal (10).
5. **Stay held:** scores/AI/free-media cleanup (14), club country backfill (4's data write), reminder/welcome-email activation (13).

No deployment, no data writes. Evidence-only comparison.
