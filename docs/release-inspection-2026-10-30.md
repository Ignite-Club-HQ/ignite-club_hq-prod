# Read-only release inspection — 30 October 2026

## Verdict

**Hold release.** Source recovery is not working production deployment. Inspections found two concrete handler authorization gaps, two hosting-policy conflicts and a confirmed recurring ICP PROD scheduling conflict. No app code, SQL, access rules, credentials, jobs, hosted settings or deployments were changed during this inspection; only this report and the roadmap were updated.

## Confirmed findings

### 1. Restored cron handlers need internal authorization

- `supabase/functions/auto-rsvp-push-cron/index.ts:93–101` rejects bad secrets only when `AUTO_RSVP_DM_CRON_SECRET` exists. With it absent, the check permits calls. It then constructs a service-role client, acquires a lock, reads audiences and writes/sends notifications (`103–110`, `228–263`).
- `supabase/functions/chat-photo-gallery-reminders/index.ts:23–29` constructs a service-role client and takes a lock with no caller check. It subsequently posts reminders via a protected-capability RPC (`172–193`).
- Neither has an explicit gateway exception in current config. Default JWT verification blocks invalid tokens but does **not** authorize ordinary signed-in users to run internal jobs. Actual deployed overrides/secrets are unknown; these are source defects, not proof of a live exploit.
- Repair: verify an internal service-role or configured scheduler credential immediately after OPTIONS, before client creation or any lock/read/write; fail closed if secrets are absent. Preserve the auto-RSVP legacy header/query credential only where required by verified existing cron callers. Do not widen gateway access before this boundary exists or change production schedules/credentials during the repair.

### 2. Netlify policy blocks existing app resources

- `netlify.toml:54` permits only `id.ai` in `frame-src`. `frontend/src/components/GoogleMapEmbed.tsx:87,111` embeds Google Maps from `https://www.google.com`; these frames would be blocked under the configured policy.
- The same policy excludes ICP blob origins from `connect-src`. `frontend/src/live/mediaStorage.ts:84–88` constructs `https://<canister>.raw.icp0.io` URLs; encrypted image/document downloads require fetching those origins before local decryption. The policy would block these fetches on the Netlify-hosted app.
- Repair: add only the required map and verified blob-store origins while preserving the other restrictions. This source review does not prove the exact policy currently served by hosted Netlify.

### 3. Scheduled ICP PROD delivery cannot recur with today's default branch

- GitHub GET inspection through Paul's GitHub API confirmed repository default branch **main**. Current PROD source remains `ea005b7178a6de9c207b744a2ea65cffde713b5f` (21 October).
- GitHub scheduled workflows execute on the default branch. `.github/workflows/icp-push-deliver-prod.yml:18` requires `github.ref == 'refs/heads/prod'`, so the scheduled main run skips delivery even if the activation variable is later enabled. Manual prod dispatch is separate; no dispatch occurred.
- Repair: separately approve a scheduler design that starts from the default branch but checks out and validates exact prod source before any delivery, or another approved branch-specific scheduling mechanism. Do not change the default branch casually or activate any worker from this inspection.

### 4. Database release is intentionally nonfunctional until reconciliation

- `.github/workflows/promote-to-prod.yml:30–35` deliberately exits 1; it has no migration/function-deployment steps. This is a safe release hold, not a restored operational deployment path.
- Six auth migration entries remain blocked. The signup migration replaces `handle_new_user` with an ID-only profile insert; original hosted function/triggers remain unavailable. The archive did not establish the original signup implementation. DEV fixture SQL, DEV activation IDs and permission repairs must not be treated as approved PROD changes.
- 1,135 original SQL sources are byte-verified recovery evidence outside executable migrations, not reconciled production ledger entries. No SQL was run.
- Empty/missing `emailAuthClubs` intentionally keeps email signup open; this is the existing off-switch, not a new defect. A populated allowlist's enforcement must be confirmed against authoritative PROD invitations/settings before activation.

### 5. Source release holds do not enforce hosted publication ordering

- Fresh GET of effective PROD GitHub rules returned **deletion protection only**. A branch-level `protected` boolean does not establish required checks. No required release-check rule appeared in that result.
- No current source gate makes Netlify/Codemagic publication wait for successful DB and ICP promotion. Actual hosted trigger dependencies remain unavailable. A successful mobile/web build must not be mistaken for completed database deployment.

## Checked without a confirmed defect

- All three active native release helper paths resolve from their specified working directories. Android Firebase/artwork paths resolve correctly to root `firebase/` and `android-assets/` (the initial path concern was ruled out).
- Store identity, recovered version `1.2.63`, signing-group references and current hybrid/native callbacks remain in source; this is not proof hosted groups exist or stores accept the candidate.
- Foreground presentation config names are supported by installed plugins. FirebaseMessaging's presentation options are iOS-specific; actual Android/iOS banner behavior requires devices.
- Giphy API connection is permitted and wildcard image host configuration covers the listed Giphy hosts; no concrete Giphy source defect was established. Returned image origins are not inspected here.
- Netlify's `frontend` base and `dist-live` publish paths are internally consistent. Provider CLI output shape, exported IPA location, runtime Edge Function environment availability and `/share` precedence remain provider acceptance questions, not confirmed errors.

## Validation and access boundaries

- **43 local release/provenance/environment/version tests passed**, zero failures/skips.
- **57 restored Deno auth/fan-out/queue/cleanup tests passed**, zero failures. They use fixtures/mocks and package-host-only network permissions; none exercise the two insecure handlers or prove phone delivery.
- GitHub requests were GET only: repository/default branch, current PROD head and effective branch rules. No credential values, environment secrets, webhooks, dispatches or mutations were requested.
- Available workspace connections include GitHub but no Netlify, Codemagic or PROD database access. No corresponding private service access variables were available. This project's database integration is DEV; no PROD substitution or connection change was attempted.
- Actual PROD ledger/functions/cron/settings, Codemagic signing/provider access, Netlify runtime/context configuration and phone receipt/tap-through remain unverified.

## Next repair scope

Repository-side: fix the two handler boundaries with mocked no-side-effect/legacy-compatibility tests; narrow hosting policy fixes; prepare the separately disabled corrected PROD scheduler; integrate a real evidence-backed DB promotion path only after authoritative PROD before-images/history are obtained. Hosted configuration changes, production execution and phone acceptance remain separately authorized actions.