# Main-backup scan: push, production deployment and Codemagic

## Verdict

**Do not merge current main to PROD yet.** The main backup contains production operations code and Supabase history absent from the hybrid main. Restore selected sources and adapt release configuration; do not replace main wholesale or run the old workflow unchanged.

This is a source comparison, not a live production audit. Missing local files do not delete already deployed Supabase functions automatically, so the findings do **not** establish that today's production notifications stopped working.

## Source and scope

- Verified GitHub branch: `Ignite-Club-HQ/ignite-club_hq-prod/main-backup` at `96642d0750e03d933b68957d61999de3ae983b9c`.
- Current main branch observed at scan start: `e2bac114d1a4eefdeecbb385137a3933bbc0a1dd`; source comparison uses the current checkout, including release preparation already recorded here.
- Read the complete backup file tree (not truncated), all 183 legacy Supabase function files, backup Codemagic/Netlify/Capacitor configuration, and supporting deployment workflows. Public source was staged under `/tmp/main-backup-audit`, not copied into the app.
- Backup has **119 function entry points**, versus **3** in current main. All **183** backup function files are absent at their original paths. Current welcome-email and ICP receipt functions are additional work and must be preserved.
- Backup has **1,135 migration files/versions absent from main**; current main has 34 migration files. This is filename/version inventory evidence, not a determination that every old migration is unapplied or needs execution.
- **50** backup endpoint names still appear in main's literal function calls. That is static coverage, not proof every caller executes in Supabase mode; it demonstrates restoration scope extends beyond a single push sender.
- **44 current release-safeguard tests passed**, zero failures/skips: production hybrid build, ICP environments, PROD push configuration and workflow environment names. These do not exercise restored code, hosted signing or actual phone receipt.

## 1. Supabase push: restore a complete source chain

### Required sender and queue sources

Bring back matching source, tests and reviewed per-function configuration for:

- `supabase/functions/send-push-notification/`
- `supabase/functions/send-fcm-notification/` — the first sender invokes this for phone delivery.
- `supabase/functions/process-push-delivery-queue/` — worker, delivery logic and authentication tests.
- `supabase/functions/process-message-notifications/`
- `supabase/functions/process-event-notifications/` — retain its split recipient, dedupe/message helpers and queue tests.
- `supabase/functions/sync-dispatch-credentials/`
- `supabase/functions/test-push-notification/`
- `supabase/functions/retry-missed-push-notifications/`

Shared dependencies include `_shared/callerAuth.ts`, `internal-auth.ts`, `cron-auth.ts`, `outboundGuard.ts`, `pushDispatch.ts` and `clubChatBot.ts`. The inspected core sender/message/event/reminder subset has a **22-file local-import closure**; HTTP-invoked endpoints and their tests are additional dependencies, not covered by imports alone.

### Preserve notification coverage, not just basic sending

Restore/review the used Supabase reminder, broadcast and notification endpoints as a matching set, including `send-event-reminders`, `auto-rsvp-push-cron`, `send-update-reminder`, `send-club-announcement`, `send-association-broadcast`, `send-competition-broadcast`, `notify-event-note`, `notify-join-request-decision`, `chat-photo-gallery-reminders`, `send-event-view-reminder`, `cleanup-push-subscriptions` and `check-push-failure-rate`. Keep their audience authorization, dedupe, retry and cleanup behavior.

`send-email` exists in the complete backup and is called from **32 current source files**. Restore its dependencies/templates and related notification email sources where Supabase callers remain. An earlier partial-source observation that the backup lacked this endpoint was superseded by this complete scan.

### Configuration and runtime evidence

- Current `supabase/config.toml` no longer contains the legacy sender/worker configuration. Merge reviewed entries only; do not overwrite the DEV project ID or current welcome-email/ICP settings.
- Do not blanket-disable JWT verification. Establish each handler's internal caller/role/token authorization before preserving its gateway configuration, especially cron and bootstrap handlers.
- PROD FCM credentials, Vault dispatch credentials, queue tables/RPCs, `fcm_tokens` policies and cron callers require read-only hosted evidence. Preserve existing credentials/jobs; no rotation, rescheduling, pruning or activation is authorized by this report.
- Existing native frontend Supabase registration remains in `frontend/src/lib/nativePush.ts` and `useNativePush.ts`. Keep the new II/ICP branch; do not replace these files with old Supabase-only versions.
- The separate ICP PROD worker remains disabled/unprovisioned pending its own acceptance. Legacy Supabase senders do not substitute for it.

## 2. Production database deployment: recover the existing runner safely

### Required recovery/adaptation

Restore the **existing** `.github/workflows/promote-to-prod.yml` path, adapted to current main and protected by the release preflight. It is in the backup and current PROD commit, absent from main. The ICP promotion workflow does not apply Supabase migrations.

The backup runner's push parity checks require missing `process-message-notifications`, `_shared/cron-auth.ts` and cron-authenticated handlers. Restoring the workflow alone therefore still leaves source dependencies unresolved.

**Migration provenance is a major blocker.** The old runner automatically treats target history absent from local files as orphaned, repairs those versions as reverted and then directly deletes history rows. With 1,135 backup versions absent from main, this must not run unchanged. Preserve exact applied history and review the independently verified PROD ledger and complete ordered/hash-bound pending plan. Do not edit applied files, copy migrations with ordinary file tools, delete ledger entries or casually mark SQL applied. Any approved history recovery/reconciliation must use the governed migration process.

Also constrain/review:

- DEV skip markers that mark files applied while ignoring failures.
- The legacy direct-`psql` migration path, which currently runs before normal `db push`.
- Changed-files-only SQL guards that strip `DO` bodies, which can execute during migration.
- Vault/dispatch credential changes, cron rewrites and trigger repairs: they can affect existing Supabase push and need separate reviewed authorization.
- Manual dispatch: the old workflow can create storage buckets, so it is not a safe read-only evidence command.

### Keep release ordering real

The old header claims database deployment finishes before Netlify/Codemagic, but the workflow source itself does not enforce those external builds waiting for its success. Current Codemagic also has no explicit backend-success wait. Verify hosted trigger dependencies, then ensure store/web publication cannot ship ahead of a failed DB or ICP promotion. A comment or a past green build is not that guarantee.

PROD currently has no required release checks in its effective branch rules (only deletion protection was returned). A source CI hold alone cannot prevent a merge. Changes to GitHub protections require separate approval.

### Supporting operations to assess, not blindly enable

The backup contains missing `deploy-dev-function.yml`, `schema-diff.yml`, `nightly-backup.yml`, backup/restore workflows and scripts. Preserve useful DEV function testing and read-only comparison paths with pinned tools and strict targets. Review protected production backup/recovery access and artifact handling separately. Do not enable scheduled PROD exports or restore operations merely to restore file parity. Old iOS scaffold/key-generation/fixture workflows are not required for a normal signed update and should not be reinstated wholesale.

## 3. Codemagic: adapt selected settings, preserve the new structure

### Already preserved — do not roll back

- Store workflow keys `android-workflow` and `ios-workflow`.
- Package/bundle ID `app.lovable.igniteteamhub` and App Store ID `6758928691`.
- Actual current App Store integration name `Codemagic` (not the stale name in some comments).
- PROD-only database/ICP guards, `frontend/dist-live`, current native II callback and status-bar handling.
- Dependency installation through `scripts/ensure-frontend-deps.mjs`. The backup's root `npm ci` targets a different package structure and must not replace this.
- Both committed Firebase configuration files are **byte-identical to the backup**. Android artwork exists, though some artwork differs; it is not a missing-file push blocker.
- Signed iOS workflow already invokes `scripts/native-push-ios.sh`: plist inclusion, production APNs entitlement, background remote notifications, Firebase initialization and APNs forwarding are implemented. Do not claim this wiring is entirely absent or overwrite AppDelegate wholesale.
- Installed Firebase Messaging plugin declares Firebase dependencies for CocoaPods/SPM. No demonstrated reason to import the backup's hand-written SPM package.

### Gaps to close

1. **Signing/environment groups.** Backup store workflows use `android_signing`/`supabase_prod`; current Android names only `google_play_credentials`, while current iOS has no `supabase_prod` group. Existing hosted groups cannot be inferred from YAML. Confirm the selected workflow gets its keystore, passwords, alias, Play account and PROD public key. Map old `VITE_SUPABASE_PUBLISHABLE_KEY` provisioning to current `IGNITE_LIVE_SUPABASE_ANON_KEY`; do not copy private keys or restore DEV defaults.
2. **Foreground notification presentation.** Backup deliberately gives presentation to PushNotifications and sets `FirebaseMessaging.presentationOptions: []` to prevent duplicate alerts. Current Capacitor config omits both. Installed Firebase plugin defaults to alert/badge/sound, so choose one presenter with version-appropriate options and test foreground receipt, sound and badge behavior. Keep II registration and existing tap suppression.
3. **Version/release checks.** Backup checks App Store and TestFlight build numbers and validates archived version/build. Current iOS queries only TestFlight; Android queries only the internal track. Both fall back to zero on lookup failure. Restore/adapt fail-closed lookups, monotonic build numbers across relevant released tracks, and archived marketing-version/build validation. Current marketing version must be verified against App Store's accepted version; incrementing build number alone is insufficient evidence.
4. **Native prerequisites.** Preserve current Firebase resource paths and APNs helper; verify generated iOS dependencies and signing entitlements in an actual Codemagic build. Do not add an old Android receiver unless the installed plugin's generated manifest demonstrates it is needed. Audit current native permission usage and working link returns without reviving obsolete domains/schemes.
5. **Crash reporting/ads.** Backup injects Crashlytics and AdMob configuration; current workflow/dependencies do not retain that setup. This is not the FCM sender chain. Restore compatible diagnostics/ads only if those features remain required; do not add an unused SDK as a push fix.

## 4. Web production hosting: adapt Netlify, do not replace it

Backup `netlify.toml` enforces a PROD database context; current file relies on hosting variables and defaults in `icp-environments.mjs`. Recover explicit production binding to PROD using current `IGNITE_*` names, while keeping DEV on main and the current frontend build layout. Inspect hosted settings before asserting their values.

Restore/review the backup's SPA fallback and `/share` edge handler if those entry points remain needed. Current configuration lacks those entries; retain the new `/api/*` handlers. Current Netlify function sources are under `frontend/netlify/functions`, so verify actual host resolution rather than declaring those files missing.

Review current security headers for production assets: its image policy does not allow Supabase-hosted images, even though the connection policy lists Supabase. Check real image/video/font/network needs and allow only required origins; do not weaken all headers to fix a single asset. Keep Internet Identity popup compatibility.

## Recommended restoration batch and release order

1. Preserve/reconcile original Supabase history against verified PROD evidence; stop unsafe orphan handling.
2. Recover legacy Supabase endpoints plus matching shared code/tests/config, keeping newer ICP and welcome-email functions.
3. Adapt the existing DB runner with preflight before every write and verified publication ordering, preserving current ICP promotion.
4. Adapt Codemagic group mapping, presentation and version guards; preserve store identity, current install path and PROD-only targeting.
5. Adapt Netlify production binding and retained entry points without undoing hybrid handlers/security.
6. Run restored code tests and an approved release-candidate acceptance matrix: email and II accounts, message/event/reminder/broadcast push, token refresh/removal, foreground/background/closed receipt and tap-through on Android/iOS, sign-in/invites, and web direct links.

**Outstanding evidence:** actual PROD ledger/functions/cron/config, Codemagic selected groups/signing/provider access, Netlify hosted context/trigger settings, provisioned ICP PROD inventory and phone receipt. None can be certified from this backup alone.

No production data, settings, credentials, jobs, deployments or source restoration were changed during this scan.