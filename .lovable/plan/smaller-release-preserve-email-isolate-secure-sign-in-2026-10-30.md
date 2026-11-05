# Smaller release: preserve email, isolate secure sign-in

## Result

Provide two equal sign-in tabs, with the selected form open immediately and no public club names. Existing email members retain their working app, scores and notifications. Internet Identity users enter a complete ICP-backed app rather than legacy pages that cannot authorize their accounts.

This plan covers local preparation and DEV testing only, not a production merge, database changes, canister provisioning, publication, scheduler activation or DNS changes.

## Build

1. **Preserve the existing email app.** Assemble a local release candidate from the inspected production source, retaining its startup, Supabase provider, score/History paths, notification handlers and native initialization. Fingerprint unchanged files and keep all migration originals outside executable staging.
2. **Isolate secure sign-in.** Package the current ICP app under a separate entry point and explicit path namespace. Retain its authorized club/team, invite, profile, chat and event flows; omit AI score review and deferred score/History adaptations. Do not substitute onboarding alone for a usable club app.
3. **Connect the tabs.** Port the controlled selector into both screens. Switching reloads the document directly into the selected form, so only one app and its listeners run. Preserve email sessions, reset/OAuth callbacks, invitation destinations and notification links. Reject unsupported cross-runtime destinations rather than opening the wrong app.
4. **Port the narrow email policy.** Adapt invitation validation and token hand-off to the preserved signup method. Remove named-club public denial wording. Keep existing sign-in separate. Stage the existing two SQL drafts only after fresh target reconciliation; preserve production profile creation and account triggers.
5. **Keep administrator scope narrow.** Prepare only the retained-email setting for authorized app administrators, preserving unrelated settings and existing entitlements. Do not copy the expanded Placement Settings page or claim all nine adaptations are released.
6. **Prepare hosting and native packaging.** Add multi-entry output, secure deep-link handling and service-worker exclusions using the existing dependency installer. Preserve store identity, signing integration and branch-specific database/canister checks. Keep deployment/publication holds intact.

## Verification

- Confirm only one runtime initializes per document; switching clears in-memory state without transferring credentials between origins.
- Test email restoration, login, reset/OAuth return, invited signup, rejected uninvited signup, profile creation and administrator access.
- Test Internet Identity callback completion, expiry/retry/sign-out, profile completion, membership discovery and authorized club/team invitation flows. Secure users must never fall back to legacy Supabase pages.
- Compare preserved email score and notification sources against the production baseline; run existing score and notification regressions.
- Check both entry points, direct links and refreshes in the browser. Hosted acceptance and real-phone notification receipt/tap-through remain necessary before release.

## Current external blockers

The checkout has no committed PROD backend or frontend canister mappings. This does not prove hosted credentials are missing, but secure production availability cannot be verified or enabled from the present inventory. Existing DEV canisters must never be relabelled as PROD.

Fresh independent PROD database evidence, Netlify/Codemagic settings and authenticated hosted/device testing are required. Source preparation can proceed without these; production release cannot.

## Technical boundary

- Independent Vite entry points and explicit path ownership separate module evaluation, providers, fetch interceptors and listeners through full document navigation. Shared-origin storage and service workers still require deliberate isolation.
- Retain legacy early Vault OAuth capture, notification launch handlers, service-worker readiness and native startup. Do not replace the email entry with current `product-main` or combined `useAuth`.
- Secure entry retains the existing matching auth/core SDK majors and native callback flow; no SDK migration is included.
- Bind candidate assembly to the inspected production source fingerprint. Dependency discovery is review input, not permission to copy the current application wholesale into the email runtime.
- Preserve owner approval as scope intent, not deployment approval; do not unlock runners.