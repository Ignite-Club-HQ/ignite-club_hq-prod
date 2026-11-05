# Auth and push release closure

## Status

Repository preparation only. No PROD database, canister, credential, worker activation or release was performed. Existing applied migration files remain unchanged.

### Owner-supplied evidence received

The 30 October SQL Editor export is now recorded with its source fingerprint in `docs/release-review/`. It contains 1,137 applied versions; all 37 current migration versions are absent. It supplies the ID-only profile function, both existing account triggers, settings policies/grants and the retained clubs' IDs. These sections are no longer missing, but the connection identity is owner-attributed rather than independently verified. Complete target-object reconciliation, hosted settings and phone acceptance remain open. The separate signup/access draft preserves profile creation and does not activate routing or deployment.

## Completed locally

- App administrators are exempted before the email-club restriction, using the role read authorized by Supabase. Both retained clubs' team-only parent paths have regression tests.
- `scripts/auth-release-policy.json` fingerprints the six October 30 migrations and blocks pending application to PROD until reviewed. `auth-release-preflight.mjs` checks these against an explicitly supplied target ledger; it never connects to a database.
- A separate `[PROD] Push delivery worker` is off unless `PROD_ICP_PUSH_ENABLED=true`. It requires the `prod` branch, the `production` environment, dedicated PROD credentials, the exact provisioned base notification queue, no overlap with DEV IDs, and the approved Firebase project. The TEST worker and Supabase delivery jobs are unchanged.
- Continued preparation: preflight now rejects **all** unclassified pending migrations, including older dates, malformed/duplicate policy and inventory entries, and incomplete, reordered or hash-mismatched runner plans. Six protected migration fingerprints remain unchanged. Invitation validation rejects malformed lookup payloads, rows and usage limits/counts. 42 release-safety script tests and 45 focused frontend tests pass.
- `docs/auth-prod-read-only-evidence.sql` is a bounded catalog/configuration query pack, **not executed**. It uses a read-only transaction, statement/lock timeouts and excludes user exports, invitation contents, secrets and unrelated settings. Connection origin must be independently confirmed; null hosted project settings are not identity evidence.
- Owner approved read-only inspection on 30 Oct. GitHub evidence now identifies the existing database promotion runner and its last successful PROD run, but it is absent from main. See `docs/auth-prod-runner-evidence-2026-10-30.md`. The current inspection tools bind to DEV; PROD catalog evidence remains unavailable, not verified. No workflow was started.

## Required before merging/releasing

1. The existing runner is `.github/workflows/promote-to-prod.yml` in `Ignite-Club-HQ/ignite-club_hq-prod`, last successful PROD run #511 on 21 Oct. It is missing from main and must not be restored unchanged: review its migration-history reconciliation and cron/credential modifications, integrate the complete release preflight before any write, and require release checks on PROD merges. Do not invent a second runner or assume the ICP workflow applies SQL.
2. Obtain approved read-only PROD evidence: applied migration versions, `handle_new_user` definition, auth-user triggers, public routing SELECT policies/grants, retained club IDs, and current routing config. Do not export users or secrets.
3. Run `node scripts/auth-release-preflight.mjs /tmp/reviewed-prod-migration-versions.json` with versions as decimal strings. A successful supplied ledger check is not proof that the ledger came from PROD; independently verify its origin.
   To compare the existing runner's plan, add `/tmp/reviewed-prod-ordered-plan.json` as the third argument. This is an ordered array of `{ "file": "<migration filename>", "sha256": "<source hash>" }` objects and must match the complete pending inventory. A filtered plan cannot approve exclusions; approved reconciliation needs integration with the existing runner. Ledger-only success explicitly reports that the runner plan was not checked. CI's PROD hold remains in force.
4. The pending `13157` function replacement, `13232` privileges, `13444` fixture test and `13735` DEV activation **must not run unchanged on PROD**. A later migration cannot prevent earlier execution. Exclusion/reconciliation must be implemented by the existing approved promotion mechanism and verified against its exact ordered plan. Do not edit/delete applied migration history or mark migrations applied casually.
5. DEV-only `14542`/`14712` repairs skip PROD; the latter requires access to `pg_control_system()`. Verify the runner supports it or explicitly exclude/reconcile these through the same approved mechanism. PROD signed-out settings access needs its own reviewed narrow policy if missing.
6. Preserve the actual PROD profile-creation function. Add signup authorization as a **separate BEFORE INSERT trigger**, leaving existing AFTER INSERT profile/EOI/invitation lifecycle triggers untouched. The existing `email_signup_invite_allowed` helper may be reused only after its target schema, semantics and privileges are verified. Do not infer an original function from DEV's already-replaced version.
7. Resolve exactly Bridgewater Soccer Club and Basket Range Cricket Club in PROD, check unique intended matches and membership coverage, and review the before/after config. Preserve other settings. Activate the list separately only after approval; do not silently enable immediate signup or change confirmation settings.

### Non-executed signup-guard design

```sql
-- Draft only: helper must be present, reviewed, and correct on the target.
-- Submit through the migration tool only after reviewing the PROD before-image.
CREATE FUNCTION public.enforce_email_signup_invitation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data->>'provider', 'email') = 'email'
     AND public.email_signup_invite_allowed(
       NEW.raw_user_meta_data->>'email_signup_invite_token', NEW.email
     ) IS FALSE THEN
    RAISE EXCEPTION 'Email signup requires a valid invitation for an email-enabled club.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_email_signup_invitation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_email_signup_invitation() TO service_role;
CREATE TRIGGER enforce_email_signup_invitation
BEFORE INSERT ON auth.users FOR EACH ROW
EXECUTE FUNCTION public.enforce_email_signup_invitation();
```

This design changes no `handle_new_user` body and does not restore the unknown original. Existing-provider sign-in and password recovery do not insert a new account. Other providers remain outside this guard, so verify hosted providers and decide whether they must be restricted before enabling them.

## PROD push activation prerequisites

- Provisioned PROD base queue and reciprocal domain/device-directory wiring; matching granted worker principal.
- `PROD_ICP_PUSH_WORKER_SEED`, `PROD_FCM_SERVICE_ACCOUNT_JSON` secrets; `PROD_FIREBASE_PROJECT_ID`, `PROD_ICP_PUSH_QUEUE_IDS_JSON` variables. Never copy DEV IDs. Credentials must match the Firebase project baked into native release builds.
- Default-branch caveat: GitHub schedules run only on the repository's default branch. If it remains `main`, the new workflow intentionally skips rather than reaching PROD. Establish an approved PROD-default repository scheduling arrangement or a separately reviewed explicit PROD dispatch scheduler. Manual dispatch on `prod` can verify the job, but is not recurring coverage.
- The `production` environment may require approval for every run; review how recurring delivery can run with appropriate protection. No competing worker may recover the same queue.
- Only the initial PROD base queue is supported here. Additional PROD groups require explicit verified inventory support, not fallback/discovery.
- After approval, enable the switch and confirm worker claim → FCM receipt → acknowledgement, registration/removal, and notification tap-through on Android/iOS for both email and II users.

## Remaining acceptance

Hosted PROD account creation/defaults, confirmation, invited signup, invalid/wrong-email/expired/exhausted invitations, direct Auth API rejection, existing sessions/reset, app-admin access, both retained clubs' members/parents, and native phone delivery remain unverified. External Supabase does not supply a managed browser session here. No change is declared production-ready on unit tests alone.