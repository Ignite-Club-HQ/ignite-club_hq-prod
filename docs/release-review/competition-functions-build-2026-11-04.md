# Competition functions — implementation and verification status

## Built, not deployed

Exact additive SQL: `competition-functions-prod-candidate.sql`.
SHA-256: `f567e6033cf10c764ad115f18079227d4ab64749d8d233a886a01e10ae0d2acc`.

- Fixture helpers return only authorized match IDs for competition owner/admin or organizer-club league admin. The proposed event SELECT policy uses the same audience; it exposes whole qualifying event rows, so target event policies and score-bearing columns must be reviewed before release. No score masking/copying/clearing is included.
- Vault access/management delegates to the target's existing `is_competition_admin` contract and preserves PROD's recorded manager-only policy. No new participant access, broad folder/file bypass helpers, bucket changes or Storage write-policy changes.
- Official email-invite table and four frontend-compatible RPCs: create, preview, accept and revoke. Verified Auth email and code proof are both required. Expiry is 48 hours; five wrong proofs lock the invitation. Table rows are manager-only; anonymous preview returns no email or code. `committee_member` maps to existing `committee` role storage. Row locking and the existing role unique constraint prevent duplicate grants/notifications. Existing link flows and role/chat triggers are untouched.

## Tests completed

`python3 scripts/competition-functions-rehearsal.test.py -v`: **24 passed** against the exact candidate SQL in disposable socket-only PostgreSQL, without hosted credentials. Tests cover roles/competition boundaries, fixture SELECT policy, unknown-ID/anonymous denial, grants/RLS, null/wrong/unverified email proof, expiry, lockout, revocation, archived competitions, committee mapping, concurrent same-token and multiple-token acceptance, existing roles and effect idempotency. Synthetic original links/triggers and zero/NULL score values remain intact. Synthetic triggers do not certify PROD chat behavior.

Frontend fixture/Vault contract tests: **14 passed, 15 backend-mode skips**.

## Why live testing is not complete

The available Supabase tools reach DEV `ecsdwrarzfexssxtrymj`, not PROD `yabcfiuntwqjwvschnji`. No PROD database, GitHub release credential or authenticated PROD browser session is available. Preview stays DEV; it was not repointed. No hosted migration, invite, membership grant, file or notification was created.

Read-only DEV inspection confirms these RPCs already exist there. PROD-specific manager-only Vault helpers must not overwrite DEV's broader existing participant helper just to obtain a live test. Exact PROD-shaped behavior was therefore rehearsed locally, not falsely reported as a DEV/PROD deployment.

## Remaining release steps and blockers

1. Run `competition-functions-target-check.sql` through authorized PROD access. The previous owner export proves selected object absence and role constraint fingerprints, not all current function bodies/policy semantics. Confirm existing manager helper definition, role unique/check constraints, event policy/column exposure and preserved role/profile trigger wiring.
2. Review three release-parser findings: policy calls to `can_view_competition_fixture_event`, `is_competition_admin`, and token `char_length` constraint. Existing structural checker requires separate review of function expressions. Its allowlist was **not** widened to force deployment.
3. After exact target review, register final SQL via the migration tool and add its fingerprint to the complete safe-stage inventory and approved-only release selection. Do not execute historical Vault bucket upserts, duplicate old link migrations, or copy score data. Existing signup-only approval remains unchanged; this candidate cannot silently ride a merge yet.
4. Deploy through the protected PROD workflow after reviewed source is available there. No GitHub dispatch/write tool is available in this workspace.
5. With authorized existing manager/invitee accounts, test live fixture read/denial, Vault read/denial, email creation/delivery/acceptance and permission readback. Invitation acceptance deliberately writes live membership/notification rows: use explicitly approved test identities/competition, never production users selected arbitrarily.

Competition Vault uploads remain a separate service-only Storage/bucket issue; installing access helpers alone does not repair that upload feature. Official invitation delivery also depends on the separately deployed `send-email` service. This implementation does not claim either endpoint is live or functional on PROD.
## PROD target check result (5 Nov 2026, Paul export)
- Identical to DEV: is_competition_admin, can_organise_competition, is_association_admin; all 16 events/vault_folders/vault_files policies; competition_roles constraints and triggers.
- Missing on PROD (exactly what the candidate adds): get_my_viewable_competition_match_ids, can_access_competition_vault, can_manage_competition_vault, the four competition email invite functions, and the competition_role_email_invites table with its policy.
- Conclusion: candidate fits PROD with no conflicts; additive only.
