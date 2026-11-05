# PROD follow-up checklist — do after the merge (2026-11-04)

Everything outstanding for the live database, in one place. Sources:
`remaining-feature-compatibility-2026-11-04.md` (what PROD has/lacks, from Paul's
1,515-row catalog export) and `held-items-path-forward-2026-11-04.md` (routes for
items that can't ride a merge). Nothing here is deployed yet.

## A. Confirmed gaps — release later, each with owner approval, after DEV testing

| # | Feature | What's missing on PROD | Before release |
|---|---|---|---|
| 1 | Welcome message + profile country | `send_welcome_dm`, `profiles.country` | DEV acceptance test (new account sees the message); decide on Ignite team sender account on PROD (no sender = no message sent) |
| 2 | Invitation message defaults | `club_invite_message_defaults` table | DEV test |
| 3 | Competition news admin helpers | `is_competition_news_admin`, `validate_club_news_mini_league_audience`, `club_news.competition_id` column, `is_competition_media_member` | DEV test |
| 4 | Competition Vault access checks | `can_access_competition_vault`, `can_manage_competition_vault`, `can_access_vault_folder`, `can_access_vault_file` | DEV test; private storage area is a separate approval (see C) |
| 5 | Official email invitations | `competition_role_email_invites` table + 4 email-invite functions | DEV test |
| 6 | Memory reports (admin diagnostics) | `canister_memory_reports` table | DEV test |

Release route for all of A: fingerprint each into `docs/release-review/safe-apply-approval.json`
with Paul's approval, then a main→prod merge carries exactly that batch.

## B. Needs one read-only check before deciding

- **Competition events + competition role removal:** PROD has working versions.
  Paul runs the 5-function fingerprint check (SQL in
  `held-items-path-forward-2026-11-04.md`) in the PROD SQL Editor. If the hashes
  match the recorded DEV hashes, both items close with no change. If not, compare
  on DEV before touching anything.

## C. Held — separate approval each, not before launch

| Item | Route |
|---|---|
| Email-club list (Bridgewater, Basket Range) | After the canister-connected live site is up: one PROD-only `app_settings` row with PROD club IDs (never DEV IDs), then one invited sign-up test. Until then the sign-up guard refuses nothing. |
| Club country "Australia" fill-in | Ship the optional `clubs.country` column only; no fill-in of existing clubs. |
| Hidden competition scores | Stage 1: structure (read restrictions + protected results table), scores untouched. Stage 2: separately approved one-off copy with archive. Cannot ride a merge — the checker rejects it as data writes. |
| Free-media cleanup | Install only together with the scheduled-job decision; it deletes records when called. |
| Reminder / welcome-email jobs | Structures may ship; activation (schedule, secrets) is a separate post-merge approval. |
| Competition document storage area | Create the private storage area via the storage tool only after approval. |
| AI score review | Stays deferred by owner decision. |

## D. Decisions waiting on Paul

1. Create the Ignite team sender account on PROD? (welcome message stays silent without it)
2. Turn on the email-club list after the live site rebuild? (C, row 1)
3. When to schedule reminders / welcome emails? (C)

## E. Already closed — no action

- Ladder visibility, duty team: live in PROD.
- Old competition-admin inbox: superseded by a newer replacement already on PROD.
- Email sign-up guard: approved, rides the next main→prod merge.
