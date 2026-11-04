# PROD migration master plan (2026-11-04)

One ordered plan for moving the live system (igniteclubhq.app + PROD Supabase + PROD
canisters) onto the current tested app. Nothing in this file has been deployed. Owner/approver:
Paul. Standing rules: structure only (no DEV data, no PROD data rewrites, one `app_settings`
config row excepted), canister upgrades are code-only, DEV and PROD stay separate.

**Governing rule (Paul, 2026-11-04): the live site must never break and users must never be
impacted.** Nothing reaches PROD until it is proven working on DEV or in isolated rehearsal.
PROD is never used to test whether something works — every phase below has a DEV/rehearsal
verification gate before its PROD step, and any failed gate stops that phase. If a live
acceptance check (Phase 4) fails, we stop and fix forward on DEV first; no live experiments,
no partial rollouts that degrade existing clubs, email logins, uploads or payments.

Detail lives in the linked docs; this file is the order of work.

## Where things stand

| Area | State |
|---|---|
| PROD canisters (18 + groups) | Same code as DEV; both groups open (router revision 6); funded |
| PROD approval snapshot | Published at revision 6 |
| Live website | Still the old Supabase-only build (no Internet Identity, no canister link) |
| PROD Supabase | Older schema; several features the new app calls are missing |
| Promotion workflows | Canister promotion: every prod push, code-only. DB promotion: structural-only, approved-only (currently only the email-signup guard) |
| Upload destination bug | Fixed in code (not live) |

## Phase 0 — Read-only checks (Paul, PROD SQL Editor; no changes)

1. Run the 5-function fingerprint SQL (`held-items-path-forward-2026-11-04.md`) — closes
   competition events + role removal if hashes match DEV.
2. Run `competition-functions-target-check.sql` — confirms the competition candidate fits PROD.
3. Export the PROD `backend_routing_config` row (values only) — needed to certify sign-in routing.
4. Confirm Netlify prod site settings (build command, base directory, branch, env vars).

Exit: all four results uploaded and compared.

## Phase 1 — Make the database ready for the new app (must precede the website switch)

Without these the new frontend regresses on PROD (see `full-app-prod-regression-audit-2026-11-04.md`).

| # | Batch | Candidate / tests | Still needed |
|---|---|---|---|
| 1 | Fixture visibility, Competition Vault access, official email invites | `competition-functions-prod-candidate.sql`; 24 SQL + 14 frontend tests passed | Phase 0 #2 result; approve 3 flagged policy expressions; fingerprint into `safe-apply-approval.json` |
| 2 | Invitation message defaults + welcome DM | `invitation-welcome-prod-candidate.sql`; 12 SQL + 24 frontend tests passed | Decide/create PROD Ignite sender profile; fingerprint |
| 3 | Profile country + club country column (no backfill) | DEV migration applied 4 Nov | DEV acceptance test; PROD candidate + fingerprint |
| 4 | Competition news admin helpers | DEV migration exists | Build PROD candidate + isolated tests; fingerprint |
| 5 | Memory reports table | DEV migration exists | Build PROD candidate; fingerprint |
| 6 | `welcome_email_settings` table (structure only, no activation) | DEV migration exists | Build candidate; fingerprint |
| — | Email-signup guard | Approved, rehearsed | Rides the merge (dormant until club list set) |

Exit: every batch registered in the approved-only inventory with Paul's sign-off; DB promotion
safe-plan shows exactly these items and nothing else.

## Phase 2 — Make the website build the canister app

1. On `prod`, change the hosting build so it produces `frontend/` (canister-connected) via
   `scripts/build-preview.mjs` / host-build-env, with PROD-scoped Supabase + canister IDs; refuse DEV IDs.
2. Confirm production context requires the `prod` branch; `main` stays DEV.
3. Get the red full-suite / publication tests green (audit lists them).

Exit: a local PROD-context build contains Internet Identity, PROD canister IDs and the revision-6 approval, and no DEV IDs.

## Phase 3 — The merge (Paul runs main → prod in GitHub)

Automatic on push:
- `[PROD] Promote ICP canisters to live` — code-only, changed canisters only (expected no-change).
- `[DB] Promote to Prod` — applies only approved structural batches from Phase 1.
- Hosting rebuild of igniteclubhq.app.

Confirm for the exact merge commit: both workflows succeeded (not skipped), hosting published after them.

## Phase 4 — Live acceptance (Paul, real accounts; test data only with explicit approval)

1. Bridgewater / Basket Range: existing email logins, password reset, sessions still work.
2. Internet Identity sign-in on igniteclubhq.app; profile not re-requested for existing users.
3. Create a club; teams; send an invitation; accept it; welcome message appears.
4. Upload a photo and a chat file; read them back; open a document.
5. Competition: fixtures visible to the right people only; Vault opens for managers.
6. Payments / Pro access still resolve.
7. Native apps (Codemagic prod) point at PROD and pass the same smoke test.

Exit: all pass; any failure → stop, no data fixes without approval.

## Phase 5 — Switch on held settings (separate approval each)

1. Email-club list: one PROD `app_settings` row with PROD club IDs, then one invited signup test.
2. Reminder / welcome-email jobs: schedules + secrets.
3. Competition document storage area (private bucket) + Competition Vault uploads.
4. Edge-function activation per `post-merge-edge-function-activation`.

## Phase 6 — Post-launch (parked)

- Hidden scores: structure first, then separately approved archived copy (never clear scores).
- Free-media cleanup + its scheduled job.
- AI score review (deferred).
- Club deletion: build/test on DEV, then promote.
- Onboard first clubs once Phase 4 passes.

## Who does what

| Step | Paul | Agent |
|---|---|---|
| Phase 0 | Run SQL, upload CSVs, read Netlify settings | Prepare SQL, compare results |
| Phase 1 | Approve each batch | Build/test candidates, register fingerprints |
| Phase 2 | Approve build change | Implement, test |
| Phase 3 | Run the merge | Verify workflow runs |
| Phase 4–5 | Test live, approve each switch | Prepare checklists/tools |

## Source docs

`full-app-prod-regression-audit-2026-11-04.md`, `prod-follow-up-checklist-2026-11-04.md`,
`held-items-path-forward-2026-11-04.md`, `remaining-feature-compatibility-2026-11-04.md`,
`competition-functions-build-2026-11-04.md`, `invitation-welcome-build-2026-11-04.md`,
`photo-file-upload-fix-2026-11-04.md`, `supabase-promotion-safety-2026-11-04.md`,
`prod-db-classification-2026-11-04.md`, `../../roadmap.md`.
