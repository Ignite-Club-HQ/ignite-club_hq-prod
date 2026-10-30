# Release gap closure — 30 October 2026

## Repository repairs
- Both restored internal reminder handlers now reject ordinary user/anonymous credentials and missing scheduler secrets before creating a privileged client or taking a lock. RSVP retains its configured legacy scheduler-secret path; both accept the exact configured service-role credential. Original handler bytes remain archived and checked against the unchanged restoration fingerprints.
- Netlify's policy permits Google Maps frames and HTTPS raw ICP encrypted-media downloads, without widening script or object permissions.
- PROD push scheduling can start from default `main`, explicitly checks out and verifies `prod`, and passes the checked-out commit to the existing isolated worker. Manual runs still require `prod`. The activation variable and production credentials remain unchanged; no delivery was started.
- Netlify production builds and signed Codemagic releases require read-only GitHub evidence for the exact source commit: the real `Production database deployment` job and ICP `backend` job must have succeeded. Missing/inaccessible evidence, wrong commits, failed/skipped jobs and preflight-only runs block publication. ICP frontend publication separately requires database deployment evidence for its checked-out commit.

## Important release consequences
The database workflow remains a deliberately failing, non-mutating preflight. It does **not** contain a `Production database deployment` job, so the new publication gate blocks releases until authoritative PROD migration history, account-creation definitions and the complete migration plan are reviewed and a real approved deployment path exists. No success-shaped placeholder was added.

Recovered historical schedules for the two reminder jobs used anonymous credentials. Those credentials intentionally no longer authorize these jobs. Do not deploy the changed handlers until the actual hosted schedules are inspected and an approved update supplies trusted service credentials. No jobs were modified, disabled or removed here.

Netlify/Codemagic must retrieve GitHub evidence at build time. Public repository reads need no credential; private/rate-limited reads require a narrowly scoped read-only `PROD_RELEASE_READ_TOKEN` in the service's secret settings. Missing access fails closed. Provider settings and required GitHub branch checks cannot be verified from this workspace.

## Validation and remaining external prerequisites
Validation passed: 60 release/environment/provenance/handler-execution checks, one new type-checked authorization test and 57 existing restored Deno regressions (118 total); YAML and Netlify TOML parsed successfully, and the preview reports build OK. Existing restored Deno regressions use `--no-check` due to two pre-existing typing errors in the immutable backup test; the new guard test passes with type checking enabled.

Still required: authoritative PROD history/signup/runtime/scheduler evidence; approved database runner reconciliation; hosted release/signing and evidence-read access; independently approved PROD canister/worker provisioning and activation; real Android/iOS signed-build notification receipt and tap-through. No PROD database, hosted setting, schedule, credential or deployment was changed.