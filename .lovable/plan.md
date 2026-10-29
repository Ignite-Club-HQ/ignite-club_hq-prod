# Separate test and live club services (ICP), matching the database setup

## Goal
- **Test:** the club services in use today (they hold test clubs only). Preview, `main` and the ICP test site use these together with the DEV database.
- **Live:** a new, empty set of club services. Only a promotion to `prod` deploys code to them, together with the PROD database. The store apps and igniteclubhq.app use them.

```text
main  ──► DEV database  + TEST club services  (current, auto-deploy)
prod  ──► PROD database + LIVE club services  (new, deploy on promote)
```

## Steps
1. **Label the current set as test.** Record today's canister IDs, router and groups as the `dev` environment, with no behaviour change.
2. **Create the live set.** Add a one-off, hand-started "Provision PROD canisters" workflow. It creates the main services, router, Group 1 and notification worker under a separate PROD controller/governor key, then records the new IDs as the `prod` environment. Creating canisters costs cycles, so this run needs your approval.
3. **Builds choose by environment.** The web app, the native apps (Codemagic, prod only) and the push worker read their canister IDs from that environment's file. A PROD build refuses DEV IDs, and a DEV build refuses PROD IDs (fail closed, like the database rule today).
4. **Promotion pipeline.** When `main` is merged into `prod`, the backend gets upgraded on the PROD canisters, and then the PROD routing snapshot is signed with the PROD governor key. The upgrade runs as a hand-started job with confirmation, the same way the DEV workflows already work. DEV upgrade workflows stay limited to DEV.
5. **Secrets.** Each environment gets its own secrets: `PROD_DEPLOYER_PEM`, `PROD_GOVERNOR_PEM`, and the PROD worker ID. You add the keys, because I can't create private keys for you.
6. **Tests.** Add guard tests to check that no workflow or build mixes the DEV and PROD canister IDs, keys or databases.

## What you'll need to do
- Approve the cycles spend and create the two PROD keys (I'll give exact steps).
- Run the provisioning workflow once.

## Not changed
- The PROD database, the current store apps and the live site stay as they are until you promote.
- The test clubs stay on the test services.
