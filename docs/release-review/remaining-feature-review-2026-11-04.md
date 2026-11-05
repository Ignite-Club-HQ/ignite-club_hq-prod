# Remaining feature review — 4 November 2026

Read-only preparation approved by Paul at 05:05 UTC. No database, permissions,
deployment, scheduler, hosting or canister changes were made.

## Evidence and limits

- The current manifest has 40 original sources (6 candidates, 34 holds). This is
  a source review inventory, not a fresh PROD pending migration ledger.
- The 4 November owner catalog CSV contains 737 rows: 21 relations, 369 columns,
  131 indexes, 111 constraints, 85 triggers, 16 enum labels and 4 functions.
  It does not include policies or the remaining feature-specific functions/tables.
- The October owner evidence summary records historical presence and conflicts;
  it must not be treated as fresh target compatibility or deployment authority.
- Earlier document headings saying the six-candidate comparison was blocked are
  superseded by the later received-CSV comparison. Earlier text saying there is
  no selective executor is superseded by the approved-only executor on main;
  its approval currently selects only the separated email signup check.

## Remaining groups

| Feature | Evidence-supported finding | Needed next |
|---|---|---|
| Email signup guard | Separate trigger approved and rehearsed in DEV; 4 Nov PROD catalog did not contain it. | Main→prod release and exact-run readback; do not replace profile creation. |
| Email-club configuration/public routing read | October evidence reported anonymous routing policy absent. The held original configuration uses DEV club IDs. | Verify current policy; prepare exact PROD configuration separately, retaining existing email sign-in. No config activation from this review. |
| Welcome DM/profile country | DEV catalog read on 4 Nov confirmed both and the sender profile. | New-member acceptance and PROD prerequisite check before adding this source to release approval. Profile country is not club country. |
| Club country | Older SQL combines club fields with AU backfill; DEV clubs.country was absent in the latest check. | Separate optional structural club setting from backfill; do not assume the profile column implements it. |
| Competition events | October evidence reported a legacy RPC with different parameter names/results, and missing operation table. | Compare current signatures/trigger dependencies. Existing source-bound adapter is review-only; never overwrite legacy RPC blindly. |
| Photos/news/access | October evidence reported competition scope columns and similar policies under different names. November export excludes these policies. | Compare complete current policy/function fingerprints and trigger wiring; preserve membership restrictions and cleanup. |
| Invitation message defaults | October evidence reported club_invite_message_defaults absent. | Verify current table/grants/policies before proposing creation. |
| Team invitations/fixture/requester-profile access | Dependencies appear in November export, but relevant helpers/policies are not covered. October invite helper used two arguments vs new one-argument contract. | Compare overloads and authorization; preserve accepted-team scope and fail-closed reads. |
| Official links/invitations | October evidence reported existing links/invites/claim triggers, but missing competition_role_email_invites. Multiple sources create overlapping link definitions. | Compare current RPCs/policies first; do not stack duplicate schemas or replace working claims. |
| Competition role removal | Three originals are DEV-pinned. | Compare deployed final RPC, owner guard, exact-row policies and chat-sync triggers; prepare a separate live-safe replacement only if missing. |
| Memory reports | October evidence reported canister_memory_reports absent. | Verify presence and app-admin-only grants/policies; not a signup prerequisite. |
| Competition Vault | October evidence reported scope columns already present. Original also writes a private storage bucket. | Compare helpers/policies; any private storage configuration remains a separate decision. |
| Reminder/welcome-email jobs | Originals include activation or post-merge service prerequisites. | Keep reminder activation separate and welcome-email/IAP service activation post-merge, not merge blockers. |
| Scores/AI/free-media cleanup | Scores and AI are held; media helpers can delete records when called. | No score copying/clearing, AI activation, cleanup invocation or new schedule authorized. |

## One bounded next export

Run `remaining-feature-prod-catalog.sql` in the PROD SQL Editor and export CSV.
It includes explicit requested-object presence, function overloads/fingerprints,
policies/fingerprints, effective grants, columns/default fingerprints, constraints,
indexes and trigger wiring. It returns no application rows, secrets, function bodies,
policy expressions, settings values or scheduler commands. Maximum 5001 rows; the
total count makes truncation explicit. Do not create or grant anything if it fails.

This allows missing-object and same-definition comparisons. A differing fingerprint
is not an explanation of the difference: only those differences need narrowly scoped
definition review before target-specific SQL and acceptance. This export does not
verify bucket contents/privacy, hosted Auth settings, the sender account, current
migration history or successful application flows. It authorizes no execution.