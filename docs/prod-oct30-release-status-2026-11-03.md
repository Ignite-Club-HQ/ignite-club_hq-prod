# 30 October PROD release — held before live changes

Owner approval: Paul, 3 November 2026 10:52 UTC, copy the exact verified 30 October source and upgrade 18 PROD service types in place. No permission to reinstall, copy DEV data, open groups or publish.

## Prepared
- Exact original source: `d321e85bbcdfbdd7045d5c8fcb57d937df4ac482`.
- Added exact-commit source-only mode to `scripts/promote-icp-layer.mjs` and its existing manual workflow. It copies only backend source and Cargo/Mops build inputs, not deployment configuration, IDs, receipts, website, database files or generated Wasm. Existing production-only files are retained.
- All 15 focused promotion tests pass; latest preview build log is OK.
- Compared GitHub historical and PROD trees read-only. PROD head observed: `723ec01a6c7c96148a03b49ead4c49fe43df54c6`. No GitHub writes or live deployments performed.

## Execution blockers
1. Resolved at 11:00 UTC: GitHub `main` now exposes `source_commit`. Dispatched exact historical read-only plan run `41623915897`; last observation was still planning, so success is not yet verified. Blob comparison now uses the single immutable tree listing rather than thousands of file requests.
2. The current PROD deployment workflow rebuilds `identity_access` with its acknowledged safeguard pins and checks that the built artifact contains the witness address before installing. The exact historical identity source does not include the production-account modules or their compile-time witness/approver references (`git show d321e85b:backend/identity_access/src/lib.rs` and historical tree comparison). Thus ordinary deployment cannot satisfy the current pin contract with the historical artifact. Do not skip or delete that contract silently. An explicitly reviewed historical rollback path is needed, not a new safeguard layer.
3. Added `prod-release-targets.mjs` with a tested complete 31-target plan for all 18 service types across base/g2, sharing five infrastructure services once. It requires the pinned base IDs, acknowledged g2 receipt and complete closed consensus registry; partial/colliding/foreign inventories fail closed. This planner is not yet integrated into a live execution runner; the old PROD promotion remains base-only.

## Compatibility observations
- Protection modes in compared Motoko actor sources are transient; persistent removal maps already exist in historical source. This inspection does **not** prove a Motoko stable-state incompatibility.
- Historical identity does not reference newer stable partitions 33–38. Source inspection alone does not establish whether live records there are populated, and is not permission to erase them.
- DEV's exact identity fingerprint came from the private-name direct Cargo build, not the ordinary recipe build. Preserve that artifact distinction; a regular recipe build cannot be reported as matching the tested DEV account service.

Next action: make the source-only copy action available on GitHub, then resolve the exact historical account-service rollback and bounded target inventory without reinstall, key/controller changes, data copying, opening or publication. All PROD services remain untouched by this request.

## Owner decision still required
The exact historical account program cannot also enforce the newer immutable witness binding. Adding its missing implementation changes the program/fingerprint; suppressing the check drops the enforced binding. Neither is a silent technical fix. Keep the current pinned account service (not an exact all-service DEV copy), or explicitly review retiring the newer account-protection binding for this rollback. No binding was removed. All 22 focused tests pass, including a test against the actual historical source demonstrating this conflict.