# Full-app PROD regression audit — 4 November 2026

## Verdict: do not promote the whole new frontend yet

Promoting current `main` to `prod` now is **not regression-safe** for existing
Supabase/email clubs. Confirmed source/evidence failures affect core uploads and
several existing competition, invitation and admin paths. No PROD deployment,
database query, account creation or data write was made during this audit.

## Release blockers

| Priority | Existing user flow | Evidence | Expected PROD impact |
|---|---|---|---|
| 1 | Chat images, gallery photos, scheduled-message media and Vault uploads for club users | Original purchase-service redirect reproduced in eight intercepted SDK tests and removed 4 Nov. Uploads now invoke the original authenticated Storage callback. DEV/PROD-origin transport, actual bytes and MIME tested; no hosted writes. See `photo-file-upload-fix-2026-11-04.md`. | Destination bug repaired in source; authenticated PROD upload/readback still required. Competition-vault remains blocked by separate bucket/access dependencies and DEV service-only policies; no permissions loosened. |
| 2 | Schedule competition fixtures | PROD lacks `get_my_viewable_competition_match_ids`. `EventsPage` catches its error and uses no viewable IDs. | Schedule still loads, but competition fixtures dependent on this new visibility path may disappear. |
| 3 | Competition Vault | PROD lacks `can_access_competition_vault` and related access functions. The repository throws on RPC failure. | Competition document access/list flows fail. |
| 4 | Official email invitations | PROD lacks the email-invite table and create/status/accept/revoke functions. | New email invitation create/join actions fail. Existing link flow is present. |
| 5 | Club invite default message | PROD lacks `club_invite_message_defaults`; reads/saves use it. | Settings can error; invite sheets lose the saved default message path. |
| 6 | Welcome-email settings and memory diagnostics | PROD lacks `welcome_email_settings` and `canister_memory_reports`. | Those admin settings/reports fail; not core member flows. |
| 7 | Email-club and country routing | Catalog exports cannot read the `backend_routing_config` value. | Login method and signup restrictions cannot be certified until a bounded value/status check exists. |
| 8 | Member payments | `memberCheckout.ts` uses a separate hard-coded website database, and its tests are excluded. | Payment parity is unverified; do not include payment claims in release acceptance. |

Competition event creation is compatible with the recorded PROD signature in
source tests: the wrapper retries with PROD's old arguments only after a definite
missing-signature response.

## Verified

- App sign-in screen opened without page errors on desktop and phone sizes; no
  horizontal overflow. This was a signed-out DEV preview check only.
- Supabase-mode suite reported 531 test files before its 600-second tool limit:
  527 passed and four failed. Reproduced failures: one obsolete upload test, one
  service-method count, four notification-card tests missing their test provider,
  and one pending-inbox preview case. They are not PROD-specific evidence but
  mean the full suite is not green.
- Focused login/password reset/schedule/fixture/competition-event checks:
  93 passed, 8 skipped.
- Additional focused audits: email/routing tests 36 passed; schedule/competition
  tests 35 passed, 5 skipped; Vault/notifications/media tests 80 passed, 45 skipped.
- Hosting/env checks: 38 passed, 3 failed. Failures are stale release/workflow
  test expectations, so publication tooling is not fully green.
- Literal app contracts found: 2,599 table reads/writes across 152 tables,
  237 RPC calls across 167 functions and 114 edge-function calls across 53 names.
  The PROD export covered only 33 tables, 14 RPC names and no edge-function inventory.
  Unknown coverage is not evidence of absence.

## Required before promotion

1. Verify authenticated PROD media upload/readback after release: destination repair is tested locally without loosening permissions; competition-vault authorization remains separately blocked.
2. Decide each missing database feature: release its reviewed structure, keep its
   UI unavailable, or retain the existing PROD behavior. Do not bulk-copy DEV data.
3. Obtain bounded PROD evidence for the routing row and deployed edge functions.
4. Bring the full Supabase-mode and publication suites to green.
5. Before publication, test real existing email-club accounts through login,
   club/team pages, schedule, RSVP, chat, image upload and documents. This
   workspace cannot sign into PROD.