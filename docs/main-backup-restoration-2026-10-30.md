# Main-backup restoration — 30 October 2026

## Restored on main; not released

Owner approval covers repository restoration only. No production database, credentials, jobs, settings, canisters, function deployments or hosted release were changed.

- Restored **77 exact backup files across 36 notification/email/support endpoints**, including FCM/web senders, event/message fan-out, delivery queues, reminders, broadcasts, join-request notifications, email templates, dispatch bootstrap, cleanup and matching tests. `docs/main-backup-notification-provenance.json` pins every restored file to commit `96642d0750e03d933b68957d61999de3ae983b9c` with SHA-256 fingerprints. Existing welcome-email and ICP receipt functions remain untouched.
- Merged gateway exceptions only for reviewed internal service-role/cron/admin-authenticated endpoints. Other restored endpoints keep gateway JWT verification. The optional-secret `auto-rsvp-push-cron` and ungated legacy `chat-photo-gallery-reminders` sources were recovered for provenance but **are not approved for deployment** without an independent handler-authorization review; no false gateway exception was added.
- Recovered the original `.github/workflows/promote-to-prod.yml` path as `[DB] Promote to Prod`, intentionally failing closed with no write commands. It cannot delete/revert migration history, mark DEV changes applied, rotate Vault credentials, modify cron jobs or create storage buckets. It is a release hold, **not a working production migration/deployment path yet**.
- Restored signing group references (`android_signing`, `supabase_prod`) alongside the existing Play credential group, preserving store workflow keys, bundle identity and the `Codemagic` Apple integration. Retained public-key provisioning maps to the current names; branch/database/private-key checks precede builds. No hosted group changes were made.
- Android queries internal/alpha/beta/production; iOS queries both App Store and TestFlight. Failed/malformed lookups stop rather than returning zero. Follow-up recovery restored original marketing version `1.2.63` from both the immutable backup and last verified PROD source, removing the newly introduced `CM_APP_VERSION` requirement; exported IPA identity/version/build checks remain. Android helper resolution from `frontend/android` is corrected.
- Foreground alerts use PushNotifications only; FirebaseMessaging presentation is disabled to prevent duplicate iOS banners. Native II callbacks, Firebase files, Android bar helpers and dependency installation remain intact.
- Netlify now uses the shared installer and an explicit branch-scoped build adapter, keeps main on DEV, requires prod for production context, maps legacy public-key names, preserves API handlers, restores SPA fallback and adapts `/share` to each branch's database. Image/video policy adds only the two retained Supabase storage origins.

## Validation

- 57 restored Deno authorization, event fan-out, delivery-queue and bounded-cleanup tests passed. Network access in these tests was restricted to package hosts, not Supabase or FCM; outbound delivery was not invoked.
- 9 restored email escaping/link-normalization tests passed.
- 41 release/provenance/environment/version tests passed, zero skips.
- 3 Android status-bar tests passed.
- 49 existing frontend notification tests passed; **10 backend-mode skips are not acceptance evidence**.
- Codemagic/workflow YAML and Netlify/Supabase TOML parsed successfully; preview build log reports `build OK`.

## Still required before PROD release

1. **Migration provenance/history reconciliation:** all 1,135 backup migration sources are now recovered outside the executable migration folder in `docs/recovery/main-backup`, with every file verified against immutable Git blob IDs and SHA-256. They were not copied into executable migrations or marked applied. Reconciliation still requires the governed migration process plus independently verified PROD history; source recovery alone cannot authorize replaying historical SQL. Existing protected applied files stay unchanged.
2. **Actual DB deployment:** obtain the approved read-only PROD evidence through the PROD-connected project, reconcile complete history and ordered hashes, close the six blocked auth migration risks, then adapt/enable the recovered runner with preflight before each write. Do not merge to release while its explicit hold remains.
3. **Preserve actual runtime push infrastructure:** inspect existing deployed function versions, queue RPCs, FCM/Vault configuration and cron callers without changing them; approve the exact restored function deployment set separately. Review the two held legacy handler authorization gaps before deployment.
4. **Hosted mobile/hosting configuration:** confirm the named signing groups exist and carry the original key/passwords, PROD public key, Google credentials and Apple access; confirm recovered version `1.2.63` is still accepted by App Store; confirm store lookup commands on Codemagic and that custom Play tracks, if any, are included. Strict empty-track lookup failure is intentional until real store evidence is available. Confirm Netlify branch/context-scoped variables and `/share` deployment resolution.
5. **Publication ordering:** external Netlify/Codemagic triggers still need to wait for approved DB and ICP promotion success. Source safeguards do not modify hosted trigger settings or branch protections. The recovered DB job is deliberately red until approval/evidence, not a proof those external publishers wait for it.
6. **Phone acceptance:** verify existing Supabase email users and new II users separately, including message/event/reminder/broadcast receipt, foreground/background/closed state, one banner, sound/badges and tap-through. ICP PROD provisioning/worker activation remain separate and disabled. No real phone or authenticated hosted delivery was available here.

Do not restore backup production schedules, exports, recovery jobs, fixture scripts or legacy native scaffolds simply for file parity.