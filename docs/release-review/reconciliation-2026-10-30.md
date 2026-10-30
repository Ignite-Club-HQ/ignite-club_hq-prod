# PROD object reconciliation — 30 October 2026

Evidence: owner-run read-only SQL Editor export, SHA-256 `e1de59c0…3b69`
(recorded in `prod-object-evidence-2026-10-30.json`). Read-only analysis only;
no database, canister, function, scheduler, credential or hosting change occurred.

**Review correction:** see `transition-recommendations-2026-10-30.md` for the deeper caller/ACL/full-effects review. The classifications below are historical provisional inventory, not execution clearance. Legacy event and team-invite callers remain active; three further files are DEV-only. Similarity and requested-name absence do not establish equivalence or feature absence.

## Headline finding

PROD is **not** a blank target for the 37 pending migrations. The old main
already shipped much of the October competition work: nine columns and many
policies already exist in PROD, and four functions match the pending versions
almost exactly. But seven existing PROD functions have **divergent
implementations** of the same features, and two have **different signatures**.
Re-applying the pending files verbatim would either fail, create duplicate
overloads/policies, or silently replace working PROD logic.

## Classification of the 37 pending migrations

### A. Already semantically applied in PROD — ledger-staging candidates
Verify exactly, then mark applied through the approved staging mechanism;
do NOT re-execute.

| Migration | Evidence |
|---|---|
| 20261007010000_add_competition_ladder_visibility | Complete statement matches: `competitions.hide_ladder` boolean, NOT NULL, DEFAULT false; no other statements |
| 20261015192331_dbec16fd… | Schema, constraints, indexes, five policies, both trigger wirings and four function contracts match; broader effective table privileges including TRUNCATE and explicit anon acceptance execution remain a separate unresolved ACL decision. Not unconditional staging approval |

### B. Partially applied with drift — needs a decision per object
PROD has its own version of the feature; the migration re-implements it
differently. Prefer preserving verified PROD behaviour with targeted adaptations.
Retain old overloads while existing/native callers depend on them; retirement needs dependency evidence and separate acceptance.

| Migration | Drift |
|---|---|
| 20261007020000_add_event_duty_team | column + trigger present (as `trg_validate_event_duty_team`); function body differs (0.33); migration creates a second trigger name |
| 20261009090000_add_competition_media_scope | `photos.competition_id` + media policies present under different names; `is_competition_media_member` absent |
| 20261009100000_create_competition_event_fanout | Distinct contracts: direct Create Event still calls the legacy signature; helper tries the new signature and falls back only on matching PGRST202. Preserve legacy overload and canonical competition audience; hold per-team fanout pending deliberate behaviour decision |
| 20261010010000_mini_league_news_audience | columns present; `is_competition_audience` (0.56) and `club_news_competition_ids` (0.79) bodies differ; notify functions absent |
| 20261012000000_add_competition_vault_access | vault `competition_id` columns present; access functions and all storage/vault policies absent |
| 20261014000000_allow_competition_admin_team_invites | equivalent policies exist under different names; **signature conflict** on `can_invite_players_to_team` |
| 20261014020000_add_official_join_links | functions match; equivalent policies exist under different names (migration would add duplicates) |
| 20261021003048_cc898ea3… | `hide_scores` columns present; `guard_external_competition_match_edits` (0.40) and `sync_competition_match_events` (0.06) differ substantially; entire score-privacy layer (functions, policies, triggers) absent |

### C. Provisional inventory — full-effects review required
Not a safety finding: entries include existing-object changes, incomplete explicit grants, protected-data backfill, scheduler activation and destructive capabilities. Three self-removal files are DEV-only as authored. See the transition recommendations before preparing an exact plan.

- 20260928122526 — `profiles.country` + format check
- 20261003053838 — `send_welcome_dm`
- 20261004012137 — tightens `photo_views` / `club_dm_settings` read policies (PROD still has the old permissive versions; this is a security improvement)
- 20261004045741 — anon read of the `backend_routing_config` settings row (**required for the new sign-in tabs to appear in PROD**)
- 20261008014417 — `clubs.home_country` + `lock_club_backend`
- 20261010000000 — `club_invite_message_defaults`
- 20261011000000 — `ensure_competition_admin_thread`
- 20261012010000 — scheduled event reminders
- 20261012020000 — welcome-email contract
- 20261013000000 — ICP welcome-email deliveries
- 20261014010000 — competition fixture read
- 20261014014920 / 20261014014957 / 20261014015130 — `can_view_pending_role_request_profile`
- 20261014030000 — email-bound official invites
- 20261014062816 — free-media retention
- 20261015185653 — `canister_memory_reports`
- 20261021003143 — score-privacy part 2 (depends on 20261021003048 decisions)
- 20261030030705 / 20261030030741 / 20261030031128 — competition role self-removal; **DEV-only guards raise on PROD: exclude originals and prepare a separately reviewed adaptation**

### D. Must not run in PROD (unchanged from prior review)
- 20261030013157 — replaces `handle_new_user` (PROD's is the ID-only version; use the separated draft in `signup-access-draft.sql` instead)
- 20261030013232 — depends on the replacement above
- 20261030013444 — DEV rollback fixture test
- 20261030013735 — activates DEV club IDs
- 20261030014542 / 20261030014712 — DEV-only permission repairs

## What this means for the release plan

1. The database runner needs the approved exact staging mechanism more than
   ever: category A files must be marked applied, not re-run.
2. Nine source-backed preserve/adapt recommendations are now recorded in the transition report. Existing callers require legacy event and invite compatibility; neither old overload is automatically retired. Missing equivalent-helper evidence and isolated transition acceptance remain open.
3. Category C needs complete effects/grants review; original self-removal files cannot run on PROD, and scheduling/data backfill require separate approval.
4. Category D stays excluded; the signup restriction ships via the separated
   draft after isolated-database testing alongside both existing triggers.

## Still outstanding (unchanged)

- Hosted Netlify/Codemagic settings and credentials remain unverified.
- Signed Android/iOS builds and push tap-through need real devices.
- All publication holds remain in place; this analysis grants no deployment
  authority.
