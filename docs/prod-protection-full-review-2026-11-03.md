# Closed protection commissioning — consolidated review

## Result

**Not ready for end-to-end acceptance yet.** Three independent read-only reviews plus local reproductions found four concrete faults in the candidate commissioning path. The existing 32 protection checks all pass, demonstrating that they do not cover the full runner. No live services, keys, permissions, settings, routing, deployments or GitHub approvals changed during this review. The execution hold remains intact.

This is a code-path review, not a guarantee that execution will reveal no additional faults. The next verification must exercise the actual commissioning orchestration, not repeat only the separate canister scenarios.

## Confirmed faults to fix together

| Fault | Plain-English impact | Evidence and required correction |
|---|---|---|
| Already-installed identity rejected on first preparation | The switch-on stops unnecessarily even when the right program is already installed. | `scripts/prod-protection-live.mjs:224` requires the original safeguard program before the reviewed-program skip decision at 230. Locally reproduced with original A and reviewed/live B. Use the same original/reviewed/foreign decision before creating the initial receipt; preserve certified controller/subnet checks. Test the real preparation path, not only its helper. |
| Restart skips final verification | A run can report its stage complete after sending approval without ever finishing the promised live readback. | `scripts/prod-protection-review.mjs:45–56` marks `protection-delivered` done; `scripts/prod-protection-live.mjs:124–132` returns before final verification at 358–368. Locally reproduced with a delivered receipt. Extract a final-verification continuation after retained plan/source/signature checks; resume readback without resubmitting authorization. Test both process loss and reconciliation after authorization. |
| Settings receipts expose unrelated configuration | Private service settings could be copied into GitHub records and uploaded reports. | `scripts/prod-protection-live.mjs:237–238` stores the full existing and merged environment arrays as before/after images; `save()` at 87 serializes the receipt to GitHub and an artifact file. No actual secret values were read in this review. Persist deterministic commitments instead, with the same normalized commitment in the probe; keep actual values only in memory and preserve every unrelated setting. |
| Final readback misses separately armed subject protection | The final check can pass while the separate protection used for actual people is switched off. | `backend/identity_access/src/lib.rs:1444–1458` checks global witness acceptance, whereas actual subject reads require a separate baseline. `backend/recovery_witness/src/lib.rs:139–152` reacceptance clears subject arming without invalidating global acceptance; subject authorization/read enforcement is separate at 158–203. Add bounded authenticated current-subject-baseline verification, bound to the exact approval and current lifecycle, and include it in final effectiveness checks. Test reacceptance disarming subject protection. |

## Related corrections and acceptance gaps

- **Obsolete retry rule:** `reconcileDecision()` in `scripts/prod-protection-policy.mjs:69–76` permits retry from a before-image alone, while the actual journal correctly refuses without durable proof submission never began. Locally reproduced the contradictory results. The obsolete helper is imported but not used by the runner; it is not a current live-path bypass. Remove it or align its semantics and tests.
- **Historical success versus current effectiveness:** an already `verified` receipt exits without checking current expiry or protection. Treat that as historical completion only, or provide a fresh verification path. The approval lasts 24 hours; an old successful receipt cannot establish that safeguards remain effective now.
- **Failure diagnostics:** `save()` advances its in-memory receipt before remote acknowledgement and creates its local report only after acknowledgement. A failed acknowledgement can leave no local failure artifact. Locally reproduced; no live submission was made. Retain safely redacted attempted/acknowledged state with clear uncertainty labels, never promoting an unacknowledged receipt into authority.
- **Deadline budgeting:** the isolated transport harness starts a 900-second server before two sequential builds, each allowed 360 seconds. This is a slow-worker risk, not a demonstrated current failure. Build before server start where possible or budget build plus scenario deadlines explicitly.
- **Signing interoperability:** the reviewers found no concrete Candid or signature-domain mismatch, and SDK 6.1.1 supports the inspected update/capture path. Still prove actual JS/Rust account, recovery and subject signing bytes match; matching source definitions alone is insufficient.
- **Exact already-provisioned inventory without pending intent:** one reviewer proposed a read-only adoption path. Normal interruption with retained provisioning intent is already reconciled, and this review did not establish how the proposed orphaned state arises under the current journal protocol. Do not automatically adopt it or weaken the hold; include it as a negative/unresolved-state acceptance case unless a valid provenance path is demonstrated.

## One consolidated runner acceptance suite

The successful isolated GitHub workflow exercises separate canister, certificate, fencing and all-28 scenarios. It does **not** execute the complete `prod-protection-live.mjs` multi-job sequence. There is currently no full commissioning-runner acceptance command.

Build and run one credential-free isolated acceptance suite for the same orchestration used by the held live entry point:

1. Cold dependency/import setup with the workflow's selected packages, recipe tools, artifact paths and immutable program hashes.
2. Plan plus all seven commissioning stages as fresh job processes, with separate governor/account/recovery roles and negative context/key/plan tests.
3. GitHub journal acknowledgement, content-hash CAS and stale-read simulation; no dependency on uploaded artifacts for continuation.
4. Real pinned-SDK certified calls, sync and polled replies, separate-process certificate verification, JS/Rust signing-byte comparisons and subject request acknowledgement recovery.
5. A complete before/after crash matrix across settings, identity/receiver upgrades, infrastructure authority, witness acceptance, subject authorization, inventory provisioning, inventory-to-protection review, protection authorization and final readback. Every restart must continue exactly or stop with retained uncertainty, never duplicate an unknown mutation.
6. Fresh effective global **and subject** protection verification for exactly 28 targets and 24 readers, preserved unrelated settings/photo keys, and both groups still closed. Test expiry and disarming, not only initial success.

Keep real member admission/removal/survivor flows distinct from infrastructure readback; the candidate correctly records `userAccountFlowVerified: false`.

## Checks performed

- Three independent read-only reviews: orchestration/restart; certification/permissions; workflow/acceptance coverage.
- Runner syntax check passed.
- `node --test` for protection policy, journal, evidence and review: **32 passed, 0 failed, 0 skipped** against the installed SDK.
- Local reproductions: initial original-only gate rejects reviewed/live identity; delivered authorization is marked done before final readback; obsolete retry helper conflicts with safe journal; failed journal save leaves no local report.
- Static cross-layer trace of witness global/subject arming and full-environment receipt serialization.

**Next:** fix the confirmed faults and related runner acceptance gaps as one batch, review the composed path, then run one consolidated GitHub acceptance workflow. No live activation or release authorization is granted by this report.