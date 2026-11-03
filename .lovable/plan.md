# Simplest safe path to launch

## Goal
Launch the working club app on the separate PROD services, without making everyday member access depend on repeated signing approvals or unfinished recovery tools.

**Recommendation:** simplify the added production-only dependency rather than finish the entire deletion/recovery commissioning system just to launch.

## 1. Freeze the scope and establish the baseline
- Pause the current protection switch-on. Keep both production groups closed during preparation.
- Check the result of the already-running GitHub verification; use it as evidence for the code it actually tests, not permission to launch.
- Compare the working DEV member-access path with the added PROD path and check the current PROD settings read-only.
- Produce one short, consolidated list of launch blockers. Fix only a reproducible fault, an essential access/data issue, or a failure in the launch checks below.

## 2. Make normal app use independent of deletion/recovery approvals
- Keep Internet Identity, club/team permissions, encrypted-photo/document access, and removed/suspended-member restrictions.
- Make normal sign-in and authorized club access work without the added expiring approval and safeguard round trips. Do not merely increase the expiry or turn access checks off.
- Keep unfinished irreversible account erasure and infrastructure recovery unavailable on the server, not just hidden from the screen. Check automatic and indirect entry points as well. Ordinary role removal must still revoke the relevant access and preserve other memberships.
- Reuse the existing services, addresses and keys. No new safeguard service, signing keys, approval environments or replacement canisters.
- Do not downgrade to old code blindly, reinstall services, discard retained removal records, or weaken encrypted-media authorization.

**Decision boundary:** the current code links production account reads to the safeguard system, so leaving deletion unused alone is not enough. This is a focused code change, not a flag bypass. If the existing state cannot safely support it, report the specific reason before any production change—do not start another safeguard expansion.

## 3. One complete verification on the final code
Run the final sequence on DEV/isolated services before delivery:
- Internet Identity sign-in and the retained email sign-in paths.
- Club creation/joining, teams, events and RSVP.
- Sending and reading chats; uploading and reading encrypted photos/documents.
- Authorized access succeeds; an outsider and a removed member cannot access the protected club/team content; other memberships remain usable.
- Ordinary access still works after the old approval window expires, without GitHub approval.
- Deferred destructive operations remain unavailable, including automatic/indirect paths.
- Upgrade preserves the existing state and DEV/PROD remain separate.

Include notification delivery if the launch includes it; if its separate production worker is not ready, name that limitation explicitly rather than claim delivery works. Fix confirmed failures together, then rerun affected checks—no repeated speculative review cycles or demand to prove every imaginable crash.

## 4. Deliver once, verify while closed, then launch
1. Present Paul with the exact production changes and the passing verification results. Obtain explicit approval for the upgrades/settings changes.
2. Use the existing code-only promotion process and upgrade existing PROD services without wiping or moving DEV data. Read back the actual settings/programs, service links and both groups' readiness.
3. Ask Paul for explicit group-opening and website-release approval. Publish only the matching approved production version after its required database and service jobs succeed.
4. Perform a real production sign-in and club-access check with authorized input, including an access-denial check. Any test records need Paul's approval; do not touch existing business data as a test.
5. Release store updates afterward using the existing production-only process. Keep current hosting/DNS unless separately approved.

If an essential live check fails, stop further admission/publication and use the agreed data-preserving recovery action; never reinstall or assume an older program is state-compatible.

## Deferred—not launch blockers
- Additional recovery automation, controller-fencing tooling and full deletion commissioning beyond the protections needed for the chosen launch path.
- New scaling work, score/History reconciliation and AI activation.
- Moving the website to ICP hosting or changing DNS.

Keep the existing keys/receipts for future work; deleting them is not part of simplification.

## Technical notes
- Current source: production service-account reads call the production authorization/witness path. The supplied approval lifetime is 24 hours, and reader validation checks expiry. Normal member access must not depend on renewing that operational approval.
- Separate ordinary identity/membership authorization from privileged erasure/recovery authorization. Preserve server-side caller/resource checks, revoked access, retained fences and pending-transition refusals.
- Adapt the current admission/readiness check to verify the chosen supported member-access mode; never make it report success by ignoring missing evidence. Reuse the existing general routing approval mechanism.
- Before coding, inspect the relevant ICP skills and scoped instructions. Record the resulting structural decision in AGENTS.md and add concrete access/expiry/destructive-operation regression tests.
- Current live settings and the latest GitHub result have not been reverified in this planning turn. This plan is not a readiness certificate or authorization to modify/open/publish PROD.

## What approval of this plan means
Approval starts the bounded baseline review, focused implementation and complete verification. It does **not** itself authorize production upgrades, opening groups, publication, destructive operations or production data changes.