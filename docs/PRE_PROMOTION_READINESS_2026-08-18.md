# Pre-promotion readiness review — 2026-08-18

## Scope and safety

This review covers work that can be completed before constructing promotion
tranches. It was performed on `integrate/competition-current` and did not merge
or deploy anything. No hosted database, Supabase project, frontend environment,
store, signing service, or third-party provider was contacted.

## 1. Current cumulative change boundary

The branch is a large cumulative integration branch rather than one releasable
unit. A future promotion must not treat every changed test or document as a
separate tranche: tests must travel with the production behaviour they protect.

Use these ownership rules when building the eventual tranche manifest:

| Ownership | Production paths | Tests that travel with it |
| --- | --- | --- |
| Competition | `src/features/competitions`, competition pages/components | Competition unit, integration, Playwright and local-Supabase journeys |
| Messaging/notifications | chat/message/notification features, hooks and shared routing/cache code | Messaging, notification, push, realtime and deep-link tests |
| Membership/auth | membership, invite, role, guardian and season workflows | Role, membership, invite and authentication journeys |
| Vault/media | vault/media features, pages and integrations | Vault/media permission, deletion, Drive and UI journeys |
| Pitch board | pitch, autosub, timer and formation code | Pitch-board, autosub, timer, resume and notification tests |
| Events/home | event workflows and home read models | Event CRUD/RSVP/series and home-card tests |
| Shared/governance | build scripts, CI, documentation and cross-feature infrastructure | Guard tests and baseline orchestration |

Ambiguous shared files must be assigned according to their runtime consumers,
not filename alone. A tranche is not ready if its changed production file has no
owning test set, or its tests depend on production files assigned to a later
tranche.

## 2. Deployable backend delta relative to `origin/main`

Only the following production backend paths currently differ:

- `supabase/migrations/20260724000000_harden_capacity_telemetry.sql` (new)
- `supabase/functions/check-pending-subs/index.ts` (modified)
- `supabase/functions/check-pending-subs/recipient-policy.ts` (new)
- test-only files beneath `process-event-notifications` and
  `process-push-delivery-queue`

The migration changes the `web_vitals` read policy from broad admin access to
app-admin-only access and adds a bounded, service-role-only telemetry purge
function. It deliberately creates no cron schedule. Compatibility prerequisites
are the existing `web_vitals`, `client_perf_log`, `realtime_perf_samples`,
`has_role`, and `app_role` objects. Its policy drop is intentional but still
requires explicit release review because the destructive-migration guard should
flag policy drops for human acknowledgement.

The `check-pending-subs` change extracts recipient selection without intending
to change behaviour. It must travel with pitch-board recipient-policy tests. The
other changed Edge Function files are tests/fakes and are not deployable entry
points.

Everything beneath `local-supabase-workspace/` is synthetic test infrastructure
and is **never deployable**.

## 3. Deployment trigger audit

- `.github/workflows/codespaces-review-baseline.yml` runs only on
  `codespaces-review` or manual dispatch and uses the local isolated baseline.
  It has read-only repository permission and no hosted credentials.
- `.github/workflows/promote-to-prod.yml` validates pull requests targeting
  `prod` using file-only checks. Its remote promotion job runs only after a push
  to `prod`; manual dispatch from another branch cannot enter that job.
- A push to `prod` is materially consequential: the workflow links to the
  production project, applies migrations, deploys changed functions, and also
  force-deploys notification credential/bootstrap functions. This workflow must
  never be used for a dry run.
- `codemagic.yaml` contains separate debug, production publish, and isolated OS
  regression workflows. Production workflows use signing/store/provider
  configuration and must not be triggered during tranche preparation.
- The Android/iOS OS regression workflows use isolated application IDs and must
  remain the only native targets used before promotion.

## 4. Local native verification

The following local-only fixture builds passed:

- `npm run test:android-os:build`
- `npm run test:ios-os:build`

Their safety guards confirmed no hosted Supabase/database variables, signing or
store credentials, Firebase configuration, production application IDs, or
remote `server.url`. These builds validate harness construction, not physical
device behaviour or store release signing.

## 5. External-provider contract coverage

Existing baseline coverage includes Stripe webhook and payment authorization,
IAP receipt security, push delivery and subscription reliability, notification
fan-out/navigation, event notification pagination, invite email workflows,
PlayHQ UI contracts, and Vault Drive integration boundaries. Those tests mock
external systems and protect application-owned contracts; they do not prove a
provider sandbox or live credential is healthy.

No additional speculative provider tests were added. Remaining external
acceptance evidence is intentionally manual/environmental:

- real APNs/FCM delivery and tap behaviour on physical devices;
- App Store / Play billing sandbox receipt round trips;
- Stripe sandbox webhook delivery and signature configuration;
- actual email delivery, link rewriting, and cold-start handling;
- Google Drive/Places, Giphy, and PlayHQ credential/quota health.

These gaps are already release-acceptance concerns, not reasons to weaken or
duplicate the deterministic baseline.

## 6. Rollback and dry-run rules

1. Keep `main` and `prod` unchanged while building and testing tranche branches.
2. Branch each tranche from the exact accepted base commit; do not cherry-pick
   an unreviewed cumulative range.
3. Generate a file manifest and dependency graph before every tranche PR.
4. Run the full isolated baseline and native fixture safety/build checks on the
   tranche tip.
5. Review migrations and deployable Edge Functions separately from frontend
   files. Local synthetic migrations never enter a deploy list.
6. Use a PR targeting `prod` only for file-only validation. Do not merge it until
   external acceptance and rollback decisions are recorded.
7. Roll back frontend/code with a normal revert commit. Database rollback is not
   assumed: use a new forward migration, because a migration may have changed
   data or permissions after application traffic began.
8. Stop promotion if a tranche unexpectedly changes `_shared`, `config.toml`, a
   migration, production workflow, signing configuration, or provider secrets.

## Readiness conclusion

The preparatory parts of steps 5–6 are complete without constructing or
promoting a tranche. The next safe activity is an exact tranche manifest and
dependency ordering exercise. It can remain entirely on the current branch;
creating or merging a tranche is a separate, explicit decision.
