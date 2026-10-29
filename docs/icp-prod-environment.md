# ICP test (DEV) and live (PROD) canisters

| | DEV / test | PROD / live |
|---|---|---|
| Branch | `main` | `prod` |
| Database | `ecsdwrarzfexssxtrymj` | `yabcfiuntwqjwvschnji` |
| Canister table | `deploy/mainnet/.icp/data/mappings/ic.ids.json` | `deploy/prod/.icp/data/mappings/ic.ids.json` |
| Web app canister | `deploy/frontend` | `deploy/frontend-prod` |
| Keys | `DEPLOYER_PEM`, `GOVERNOR_PEM` | `PROD_GOVERNOR_PEM` |
| Who uses it | Lovable preview, ICP test site, Netlify previews | igniteclubhq.app (Netlify `prod`), Codemagic store apps, PROD web-app canister |

## One-time setup (operator)
1. Create a new identity locally: `icp identity new ignite-prod-governor && icp identity export ignite-prod-governor`.
2. GitHub → Settings → Secrets → Actions: add `PROD_GOVERNOR_PEM` (exported text). Optional: `PROD_ICP_PUSH_WORKER_SEED`.
3. GitHub → Settings → Variables: `PROD_GOVERNOR_PRINCIPAL` (`icp identity principal`), `PROD_SUPABASE_ANON_KEY` (public anon key), optional `DEV_DEPLOYER_PRINCIPAL` (the `jfagr-…` web-app key, so PROD refuses it).
4. GitHub → Settings → Environments: create `production` (add required reviewers for a one-click approval).
5. Fund the PROD account (~10 ICP; the run prints the address), then on the `prod` branch run **[PROD] Promote ICP canisters to live** with action `provision` and confirmation `PROVISION PROD CANISTERS`.

## Every release
Merge `main` → `prod`. The workflow upgrades only the PROD canisters whose code changed since their recorded commit, core → domains → router, upgrade-only, and stops at the first failure. Progress is saved in `deploy/prod/release.json`, so a re-run resumes. Then it republishes the PROD web app.

## Not yet covered
- PROD starts with one group (the base set). Adding PROD group 2 and signing a PROD routing snapshot for it come later. Until then, the PROD app keeps group 2 closed (fail closed).
- Until provisioning, PROD builds carry an empty canister table, so live users stay on Supabase.
