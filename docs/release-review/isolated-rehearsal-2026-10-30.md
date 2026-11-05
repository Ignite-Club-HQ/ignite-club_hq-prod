# Isolated release rehearsal — 30 October 2026

## Completed

- Added offline rehearsal packaging (`scripts/prod-rehearsal-workspace.mjs`). It validates the complete ordered 37-file inventory, evidence/disposition byte fingerprints, and explicit candidate-to-original hashes before creating a temporary folder. It copies no originals, refuses excluded/deferred sources and verbatim replay, and never applies SQL. All originals remain held; the manifest cannot authorize deployment.
- Corrected the separate signup trigger draft to reject an unknown/NULL authorization decision (`IS NOT TRUE`). Production's ID-only profile function and both existing AFTER triggers remain untouched.
- Added a private invitation-helper draft outside executable migrations. Missing/empty allowlists explicitly return true, preserving the existing unarmed-email rule; malformed armed configuration, conflicting team/club scopes and invalid usage counts return false. No public invitation oracle is granted.
- Rehearsed those signup drafts in a freshly initialized PostgreSQL 17.9 cluster with TCP disabled, a private temporary socket and no inherited hosted credentials. It used only synthetic schema and records, then stopped and removed the cluster.
- Verified acceptance for invitations to each of two synthetic retained clubs, normalized email and club invitations; rejection for outside clubs, missing/unknown tokens, wrong email, expiry, exhausted/invalid counts, conflicting scopes and claimed invitations. Verified both AFTER lifecycle stand-ins still run, definitions remain unchanged, rejected signups leave no profile, unknown decisions fail closed, non-email provider behavior stays separate, and anonymous settings access sees only the routing row.
- **39 tests passed**, including existing release preflight, evidence, restoration and publication safeguards.

## Not established by this rehearsal

The local schema is a minimal synthetic stand-in, not a restored production database. It does not verify hosted Auth behavior, production trigger dependencies, real invitation consumption or concurrent one-use acceptance. The helper checks eligibility, not use reservation; those limits remain owned by the existing invite-acceptance flow and need independent acceptance before adoption.

The signup drafts are not a completed or approved release replacement and are not linked into an executable workspace. The nine feature adaptations still require target-specific SQL, complete policy composition, synthetic data preservation tests and approved original/replacement disposition. The packaging tests prove fail-closed inventory handling, not those SQL semantics.

## Next work

Prepare and rehearse the target-specific event/invitation adapters while retaining legacy contracts, then the media/news/Vault/score adaptations. Obtain independent target reconciliation and staging approval before changing the existing database runner. Hosted Netlify/Codemagic settings and signed real-device notification receipt/tap-through remain external checks.

No DEV/PROD database, migration history, canister, scheduler, credential, hosted setting or deployment was changed. No runner or publication hold was removed.