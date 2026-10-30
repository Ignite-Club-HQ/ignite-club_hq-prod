# Production merge plan (held) — 2026-10-31

Status: **HELD by owner.** Nothing merged, no PROD database or canister changes.

## Order of work
1. **Set up PROD canisters first** (before any merge).
   - Create fresh PROD canisters for every canister set in `deploy/prod/icp.yaml` and `deploy/frontend-prod/icp.yaml` (all backend groups, routers, domains, media stores, notification, frontend) — not only club canisters.
   - Install current code with empty state; record IDs through `scripts/icp-environments.mjs` (PROD_* keys only).
   - Grant controllers and the disabled PROD push worker identity; keep the recurring PROD push schedule disabled until separately approved.
   - Sign the PROD routing snapshot against the new PROD router.
2. **Merge main → prod** only after step 1 is verified.
   - `promote-icp-prod.yml` performs code-only, upgrade-only installs of changed canisters into PROD canisters, resuming per `release.json`.
   - **No test-canister data is copied.** All clubs/data in DEV/test canisters are test data and stay in DEV. PROD canisters start empty and only receive code (Wasm) upgrades; stable state is preserved across upgrades.
   - Builds refuse cross-environment IDs, keys or databases.
3. **PROD database (structure-only)** — run the five migrations in order:
   `20261004045741`, `20261030013157`, `20261030013232`, `20261030013735`, `20261030052009`.
   - Structure and permissions only; the single approved data write is the `backend_routing_config` row in `app_settings` carrying Bridgewater (`966bdaec-ebf1-46da-b2b3-cc53bf05c422`) and Basket Range (`493ee2e3-c834-487d-93be-d1c8a0dbc4a8`). Enforced by `scripts/prod-release-no-data.test.mjs`.
   - Existing `handle_new_user()` preserved; signup guard added separately.
   - Score/History and AI review excluded.
4. **After release:** signed-in checks (retained email login, invited signup, blocked uninvited signup, Internet Identity sign-in, admin tools) and real-phone push tests.

## Verified so far
- PROD migration history, `handle_new_user`, invitation/teams columns, required tables, club IDs: see `prod-checks-2026-10-30.md`.
- Live Netlify site points only at PROD Supabase (`yabcfiuntwqjwvschnji`).
- Settings row decision: `settings-row-owner-decision-2026-10-30.json`.

## Still needed before merge
- PROD canister provisioning (step 1) — needs owner approval and a funded PROD deployer identity/cycles.
