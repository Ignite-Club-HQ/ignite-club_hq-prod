# Inactive hybrid Actions copy

Source: Ignite-Club-HQ/ignite-club-hybrid at 4f157414cefc9d65f0132b5af059649a2e3e1c7a.
Destination baseline: Ignite-Club-HQ/ignite-club_hq-prod at 96642d0750e03d933b68957d61999de3ae983b9c.

36 exact workflow definitions are stored in workflows/ outside .github/workflows. They are INACTIVE and are not yet available as runnable Actions. Nothing in hybrid was edited; no existing destination file, secret, variable, workflow or branch was overwritten or removed. Destination main and prod were not updated.

## Secret names only
The two repository secrets configured in hybrid are DEPLOYER_PEM and ICP_PUSH_WORKER_SEED. Their NAMES are recorded in manifest.json; their VALUES have NOT been copied and no placeholder secrets were created.

Other names referenced by the copied definitions: FCM_SERVICE_ACCOUNT_JSON, FUEL_MONTHLY_CEILING_CYCLES (optional, falls back to a variable then zero), SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL and TARGET_REPO_PAT (migration credential only; do not copy it). Existing prod secrets stay untouched; matching names do not prove matching values or safe targets. GitHub supplies GITHUB_TOKEN automatically where used.

## Activation is a separate step
Before any activation, verify the later app merge supplies the scripts, frontend/backend source, deploy mappings, manifests, runtime dependencies and durable journal branches each workflow requires. Do not copy canister IDs or settings over prod. Validate exact live service targets, existing deploy principal, key authorities and funding policies. Secret values must be securely transferred by an authorized source Actions run or entered through secure settings; they cannot be retrieved through GitHub API.

Never merge or move these definitions into .github/workflows without separate approval. Push workers, health reports, retention jobs, scheduled fuel and all deployment workflows must remain inactive here while hybrid runs. A later single-owner cutover requires separate permission to change hybrid. The copied migration workflow is historical, not authorized for use with overwrite options or the old hyphenated destination.

This branch deliberately has no pull request: prod's existing pull-request workflows would run tests (or deployment for a prod-targeted PR). Review via GitHub's branch browser or compare view without opening a PR.
