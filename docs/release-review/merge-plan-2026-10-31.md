# Production merge plan (held) — 2026-10-31

Status: **HELD by owner.** Nothing merged, no PROD database or canister changes.

## Order of work
1. **Set up PROD canisters first** (before any merge) — done in a browser, no terminal.
   - Owner sets a passphrase only they know: Settings → Secrets and variables → Actions → New repository secret → `PROD_GOVERNOR_PASSPHRASE`.
   - Run **[PROD] Create production signing key** (branch `prod`, typing `CREATE PROD KEY`). It mints a fresh PROD identity on a runner, encrypts the key with that passphrase, and prints the principal, the funding address and one copyable encrypted block; the plain key and seed phrase are deleted, and the run refuses if a PROD key is already stored.
   - Paste the block into repository secret `PROD_GOVERNOR_PEM_ENC`, set repository variable `PROD_GOVERNOR_PRINCIPAL`, and send ICP (about US$26 covers a first provisioning) to the printed funding address.
   - Run **[PROD] Promote ICP canisters to live** with action `provision`, confirmation `PROVISION PROD CANISTERS`.
   - That creates fresh PROD canisters for every set in `deploy/prod/icp.yaml` and `deploy/frontend-prod/icp.yaml` (all backend groups, routers, domains, media stores, notification, frontend) — not only club canisters — installs current code with empty state, records IDs through `scripts/icp-environments.mjs` (PROD_* keys only), and grants controllers.
   - Keep the recurring PROD push schedule disabled until separately approved.
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
- PROD canister provisioning (step 1) — run **[PROD] Create production signing key** then **[PROD] Promote ICP canisters to live** with action `provision`. Needs the owner's `PROD_GOVERNOR_PASSPHRASE` secret, ICP sent to the printed funding address, and these workflow files present on the `prod` branch.
